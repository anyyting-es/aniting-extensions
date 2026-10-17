// VidSrc TMDB — online streaming provider for TMDB movies & series.
//
// Direct-TMDB port of aor-rex's Seanime "vidsrc" extension: the SIMKL
// title-matching layer was removed and replaced by the TMDB id / media type /
// season that Seanime passes to TMDB-capable providers.
//
// It only works with TMDB media (movies / series): it reads
// opts.media.tmdbId, opts.media.mediaType ("tv" | "movie") and opts.media.season.
//
// Reference: https://github.com/aor-rex/seanime-extensions (src/vidsrc)

const VIDSRC_API = "https://data.vidsrcme.ru/api.php";

class Provider {
    getSettings() {
        return {
            episodeServers: ["vidsrc"],
            supportsDub: false,
            supportsTmdb: true,
        };
    }

    // ---------------------------------------------------------------- helpers

    str(v) {
        return v === null || v === undefined ? "" : String(v);
    }

    // ---------------------------------------------------------------- search

    async search(opts) {
        const media = opts.media || {};
        const tmdb = parseInt(media.tmdbId, 10);
        if (!tmdb || tmdb <= 0) {
            // This provider only handles TMDB media.
            return [];
        }

        const type = String(media.mediaType || "").toLowerCase() === "movie" ? "movie" : "tv";
        const title = this.str(media.romajiTitle || media.englishTitle || opts.query);

        if (type === "movie") {
            const id = `movie:${tmdb}`;
            return [{ id, title, url: id, subOrDub: "sub" }];
        }

        const season = parseInt(media.season, 10);
        const id = season > 0 ? `tv:${tmdb}:${season}` : `tv:${tmdb}`;
        return [{ id, title, url: id, subOrDub: "sub" }];
    }

    // ---------------------------------------------------------------- findEpisodes

    async findEpisodes(id) {
        const parsed = this.parseId(id);
        if (!parsed) return [];

        if (parsed.type === "movie") {
            return [{
                id: `movie:${parsed.tmdb}:1`,
                number: 1,
                url: "1:1",
                title: "Movie",
            }];
        }

        // TV: fetch the eps map (season -> episode numbers) for this tmdb id.
        const data = await this.vidsrcEps("tv", parsed.tmdb);
        const eps = data && data.eps;
        if (!eps || Object.keys(eps).length === 0) return [];

        const seasonKeys = Object.keys(eps).map(Number).sort((a, b) => a - b);
        const episodes = [];

        // A specific season was determined for this entry: return its episodes.
        if (parsed.season && parsed.season > 0) {
            const epNums = (eps[String(parsed.season)] || [])
                .map(Number)
                .filter((n) => Number.isFinite(n) && n > 0)
                .sort((a, b) => a - b);
            for (let i = 0; i < epNums.length; i++) {
                episodes.push({
                    id: `tv:${parsed.tmdb}:${parsed.season}:${epNums[i]}`,
                    number: i + 1,
                    url: `${parsed.season}:${epNums[i]}`,
                    title: `Episode ${i + 1}`,
                });
            }
            return episodes;
        }

        // Unknown season: flatten all seasons into continuous absolute numbers.
        let number = 0;
        for (const season of seasonKeys) {
            const epNums = (eps[String(season)] || [])
                .map(Number)
                .filter((n) => Number.isFinite(n) && n > 0)
                .sort((a, b) => a - b);
            for (const epNum of epNums) {
                number++;
                episodes.push({
                    id: `tv:${parsed.tmdb}:${season}:${epNum}`,
                    number,
                    url: `${season}:${epNum}`,
                    title: `Episode ${number}`,
                });
            }
        }

        return episodes;
    }

    // ---------------------------------------------------------------- findEpisodeServer

    async findEpisodeServer(episode, server) {
        const meta = this.metaFromEpisode(episode);
        if (!meta) {
            throw new Error("vidsrc-tmdb: could not determine media from episode");
        }

        const type = meta.type;
        const tmdb = meta.tmdb;
        const season = meta.season;
        const epNum = meta.epNum;

        const full = await this.vidsrcRequestFull(type, tmdb, season, epNum);
        const data = full && full.data;
        const blobB64 = data && data.stream_urls;

        if (!blobB64) {
            throw new Error("vidsrc-tmdb: no stream_urls returned");
        }

        // Fetch the wasm whose data-section bytes form the XOR key.
        const wasmUrl = full && full.vs && full.vs.wasm_url;
        const wasm = wasmUrl ? await this.fetchBytes(wasmUrl) : null;
        if (!wasm || wasm.length === 0) {
            throw new Error("vidsrc-tmdb: failed to fetch wasm");
        }

        const urls = this.decryptUrls(wasm, blobB64);
        if (!urls || urls.length === 0) {
            throw new Error("vidsrc-tmdb: failed to decrypt stream urls");
        }

        const master = urls[0];
        const token = await this.fetchToken(master);
        const finalUrl = token ? `${master}?token=${encodeURIComponent(token)}` : master;

        const subtitles = this.mapSubtitles(full);

        return {
            server: "vidsrc",
            // Non-empty headers route playback through Seanime's /api/v1/proxy.
            // The vidsrc segment CDN rejects requests carrying an Origin or
            // Referer header, so direct browser playback fails with 403.
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36" },
            videoSources: [{
                url: finalUrl,
                type: "m3u8",
                quality: "auto",
                subtitles: subtitles,
            }],
        };
    }

    mapSubtitles(full) {
        const subs = full && full.default_subs;
        if (!subs || subs.length === 0) return [];
        const out = [];
        for (let i = 0; i < subs.length; i++) {
            const s = subs[i];
            const url = this.str(s && s.url);
            if (!url) continue;
            out.push({
                id: `sub-${i}`,
                url: url,
                language: this.str(s && s.lang),
                isDefault: i === 0,
            });
        }
        return out;
    }

    metaFromEpisode(episode) {
        // Episode ids are:
        //   movie: `movie:${tmdb}:1`
        //   tv:    `tv:${tmdb}:${season}:${epNum}`
        const idParts = String((episode && episode.id) || "").split(":");
        if (idParts[0] === "movie" && idParts[1]) {
            return { type: "movie", tmdb: idParts[1], season: 1, epNum: 1 };
        }
        if (idParts[0] === "tv" && idParts[1]) {
            const season = Number(idParts[2]);
            const epNum = Number(idParts[3]);
            return {
                type: "tv",
                tmdb: idParts[1],
                season: Number.isFinite(season) && season > 0 ? season : 1,
                epNum: Number.isFinite(epNum) && epNum > 0 ? epNum : 1,
            };
        }
        const urlParts = String((episode && episode.url) || "").split(":");
        const season = Number(urlParts[0]);
        const epNum = Number(urlParts[1]);
        return {
            type: "tv",
            tmdb: idParts[0],
            season: Number.isFinite(season) && season > 0 ? season : 1,
            epNum: Number.isFinite(epNum) && epNum > 0 ? epNum : 1,
        };
    }

    parseId(id) {
        const m = String(id || "").match(/^(tv|movie):(\d+)(?::(\d+))?$/);
        if (!m) return null;
        const season = m[3] ? Number(m[3]) : 0;
        return {
            type: m[1] === "movie" ? "movie" : "tv",
            tmdb: m[2],
            season: Number.isFinite(season) && season > 0 ? season : 0,
        };
    }

    async vidsrcRequestFull(type, tmdb, s, e) {
        const params = type === "movie"
            ? `type=movie&tmdb=${tmdb}&stream_urls=1`
            : `type=tv&tmdb=${tmdb}&season=${s}&episode=${e}&stream_urls=1`;
        try {
            const res = await fetch(`${VIDSRC_API}?${params}`);
            if (!res.ok) return null;
            return res.json();
        } catch {
            return null;
        }
    }

    // Fetches only the episode map (no stream_urls) for TV episode listing.
    async vidsrcEps(type, tmdb) {
        try {
            const res = await fetch(`${VIDSRC_API}?type=tv&tmdb=${tmdb}&s=1&e=1`);
            if (!res.ok) return null;
            const json = res.json();
            return json ? json.data : null;
        } catch {
            return null;
        }
    }

    async fetchBytes(url) {
        // wasm.php can intermittently return an empty body under rapid requests;
        // retry a few times with a small delay.
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
                if (!res.ok) continue;
                // Response body is a Go []byte exposed as an array-like object.
                const arr = Uint8Array.from(res.body);
                if (arr.length > 0) return arr;
            } catch {
                // fall through to retry
            }
            if (attempt < 3) {
                await this.sleep(500);
            }
        }
        return null;
    }

    async sleep(ms) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(), ms);
            void timer;
        });
    }

    // ---------------------------------------------------------------- decryption

    // Decrypts a vidsrc stream_urls blob (base64 ChaCha20 IETF) into a list of
    // plaintext URLs by brute-forcing the 32-byte key across all data-segment
    // pairs (the key is the XOR of two 32-byte data segments inside the wasm).
    decryptUrls(wasm, blobB64) {
        let segs;
        if (wasm && wasm.length > 8) {
            segs = this.parseDataSegments(wasm);
        } else {
            return null;
        }

        const blob = this.base64ToBytes(blobB64);
        const nonce = blob.subarray(0, 12);
        const ct = blob.subarray(12);

        for (let i = 0; i < segs.length; i++) {
            for (let j = i + 1; j < segs.length; j++) {
                const a = segs[i].bytes;
                const b = segs[j].bytes;
                if (a.length < 32 || b.length < 32) continue;
                const key = new Uint8Array(32);
                for (let k = 0; k < 32; k++) key[k] = a[k] ^ b[k];
                const plain = this.chachaXor(key, 0, nonce, ct);
                const txt = this.decodeUtf8(plain);
                if (/https?:\/\//.test(txt) || /m3u8|\.mp4/.test(txt)) {
                    const urls = txt.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
                    if (urls.length > 0) return urls;
                }
            }
        }
        return null;
    }

    // ---------------------------------------------------------------- WASM MVP parser

    readUleb(buf, off) {
        let r = 0, s = 0;
        for (;;) {
            const b = buf[off++];
            r |= (b & 0x7f) << s;
            if (!(b & 0x80)) return [r, off];
            s += 7;
        }
    }

    parseDataSegments(buf) {
        const segs = [];
        let off = 8;
        while (off < buf.length) {
            const sid = buf[off++];
            let size;
            const r1 = this.readUleb(buf, off);
            size = r1[0];
            off = r1[1];
            if (sid === 11) {
                let cnt;
                const r2 = this.readUleb(buf, off);
                cnt = r2[0];
                off = r2[1];
                for (let i = 0; i < cnt; i++) {
                    const flag = buf[off++];
                    let offset = -1;
                    if (flag === 0) {
                        const op = buf[off++];
                        if (op === 0x41 || op === 0x42) {
                            const r3 = this.readUleb(buf, off);
                            offset = r3[0];
                            off = r3[1];
                            off++;
                        }
                    } else if (flag === 2) {
                        const r4 = this.readUleb(buf, off);
                        off = r4[1];
                        const op = buf[off++];
                        if (op === 0x41) {
                            const r5 = this.readUleb(buf, off);
                            offset = r5[0];
                            off = r5[1];
                            off++;
                        }
                    }
                    let len;
                    const r6 = this.readUleb(buf, off);
                    len = r6[0];
                    off = r6[1];
                    segs.push({ offset: offset, bytes: buf.slice(off, off + len) });
                    off += len;
                }
                break;
            }
            off += size;
        }
        return segs;
    }

    // ---------------------------------------------------------------- ChaCha20 (IETF)

    rotl(x, n) {
        return ((x << n) | (x >>> (32 - n))) >>> 0;
    }

    QR(x, a, b, c, d) {
        x[a] = (x[a] + x[b]) >>> 0; x[d] = this.rotl(x[d] ^ x[a], 16);
        x[c] = (x[c] + x[d]) >>> 0; x[b] = this.rotl(x[b] ^ x[c], 12);
        x[a] = (x[a] + x[b]) >>> 0; x[d] = this.rotl(x[d] ^ x[a], 8);
        x[c] = (x[c] + x[d]) >>> 0; x[b] = this.rotl(x[b] ^ x[c], 7);
    }

    chachaBlock(key, counter, nonce) {
        const st = new Uint32Array(16);
        const c = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
        for (let i = 0; i < 4; i++) st[i] = c[i];
        for (let i = 0; i < 8; i++) {
            st[4 + i] = ((key[4 * i] | (key[4 * i + 1] << 8) | (key[4 * i + 2] << 16) | (key[4 * i + 3] << 24)) >>> 0);
        }
        st[12] = counter >>> 0;
        for (let i = 0; i < 3; i++) {
            st[13 + i] = ((nonce[4 * i] | (nonce[4 * i + 1] << 8) | (nonce[4 * i + 2] << 16) | (nonce[4 * i + 3] << 24)) >>> 0);
        }

        const x = new Uint32Array(st);
        for (let i = 0; i < 10; i++) {
            this.QR(x, 0, 4, 8, 12); this.QR(x, 1, 5, 9, 13); this.QR(x, 2, 6, 10, 14); this.QR(x, 3, 7, 11, 15);
            this.QR(x, 0, 5, 10, 15); this.QR(x, 1, 6, 11, 12); this.QR(x, 2, 7, 8, 13); this.QR(x, 3, 4, 9, 14);
        }
        const out = new Uint8Array(64);
        for (let i = 0; i < 16; i++) {
            const v = (x[i] + st[i]) >>> 0;
            out[4 * i] = v & 0xff; out[4 * i + 1] = (v >>> 8) & 0xff; out[4 * i + 2] = (v >>> 16) & 0xff; out[4 * i + 3] = (v >>> 24) & 0xff;
        }
        return out;
    }

    chachaXor(key, counter, nonce, data) {
        const out = new Uint8Array(data.length);
        let c = counter;
        for (let off = 0; off < data.length; off += 64) {
            const block = this.chachaBlock(key, c, nonce);
            const n = Math.min(64, data.length - off);
            for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ block[i];
            c = (c + 1) >>> 0;
        }
        return out;
    }

    // ---------------------------------------------------------------- byte helpers

    base64ToBytes(b64) {
        // goja_nodejs Buffer supports base64; avoids needing global atob/btoa.
        return Uint8Array.from(Buffer.from(b64, "base64"));
    }

    // Minimal UTF-8 decoder (goja lacks TextDecoder). Decrypted URLs are ASCII.
    decodeUtf8(bytes) {
        let out = "";
        let i = 0;
        while (i < bytes.length) {
            const b = bytes[i];
            if (b < 0x80) {
                out += String.fromCharCode(b);
                i++;
            } else {
                let len = 1;
                if (b >= 0xc0 && b < 0xe0) len = 2;
                else if (b >= 0xe0 && b < 0xf0) len = 3;
                else if (b >= 0xf0) len = 4;
                const chunk = bytes.slice(i, Math.min(i + len, bytes.length));
                try {
                    out += Buffer.from(chunk).toString("utf8");
                } catch {
                    out += String.fromCharCode(b);
                }
                i += len;
            }
        }
        return out;
    }

    async fetchToken(masterUrl) {
        try {
            const origin = new URL(masterUrl).origin;
            const res = await fetch(`${origin}/generate.php`);
            if (!res.ok) return "";
            const t = res.text();
            const ts = typeof t === "string" ? t : String(t || "");
            return ts.trim() && !ts.startsWith("<") ? ts.trim() : "";
        } catch {
            return "";
        }
    }
}
