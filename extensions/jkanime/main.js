class Provider {
    baseUrl = "https://jkanime.net";
    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    getSettings() {
        return {
            episodeServers: ["JK", "StreamWish", "Vidhide", "Mp4upload", "YourUpload", "Voe"],
            supportsDub: false,
        };
    }

    _cleanId(href) {
        return href
            .replace(this.baseUrl, "")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "");
    }

    _b64Decode(str) {
        try {
            if (typeof atob === "function") {
                return atob(str.trim());
            }
        } catch (e) {}
        return "";
    }

    _unpackJs(html) {
        const match = html.match(/eval\(function\(p,a,c,k,e,[rd].*?split\('\|'\)\)\)/);
        if (!match) return null;
        const packed = match[0];
        const m = packed.match(/\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!m) return null;
        const p = m[1];
        const a = parseInt(m[2], 10);
        const c = parseInt(m[3], 10);
        const k = m[4].split('|');

        const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const decodeRadix = (word, radix) => {
            if (radix <= 36) {
                const val = parseInt(word, radix);
                return isNaN(val) ? -1 : val;
            }
            let res = 0;
            for (let i = 0; i < word.length; i++) {
                const idx = alphabet.indexOf(word[i]);
                if (idx === -1 || idx >= radix) return -1;
                res = res * radix + idx;
            }
            return res;
        };

        return p.replace(/\b\w+\b/g, (w) => {
            const idx = decodeRadix(w, a);
            if (idx >= 0 && idx < k.length && k[idx]) {
                return k[idx];
            }
            return w;
        });
    }

    _normalizeServerName(name) {
        const n = name.trim().toLowerCase();
        if (n.includes("jk") || n.includes("magi") || n.includes("desu")) return "JK";
        if (n.includes("streamwish") || n.includes("wish")) return "StreamWish";
        if (n.includes("vidhide")) return "Vidhide";
        if (n.includes("mp4upload")) return "Mp4upload";
        if (n.includes("yourupload")) return "YourUpload";
        if (n.includes("voe")) return "Voe";
        return name;
    }

    _detectServerFromUrl(url) {
        const u = url.toLowerCase();
        if (u.includes("jkplayer") || u.includes("playmudos")) return "JK";
        if (u.includes("streamwish") || u.includes("fastwish") || u.includes("wishembed")) return "StreamWish";
        if (u.includes("vidhide")) return "Vidhide";
        if (u.includes("mp4upload")) return "Mp4upload";
        if (u.includes("yourupload")) return "YourUpload";
        if (u.includes("voe.sx") || u.includes("teresapoliticallearn")) return "Voe";
        return null;
    }

    async search(opts) {
        const queries = [];
        if (opts.query && opts.query.trim()) queries.push(opts.query.trim());
        if (opts.media) {
            if (opts.media.romajiTitle && !queries.includes(opts.media.romajiTitle.trim())) {
                queries.push(opts.media.romajiTitle.trim());
            }
            if (opts.media.englishTitle && !queries.includes(opts.media.englishTitle.trim())) {
                queries.push(opts.media.englishTitle.trim());
            }
        }

        const results = [];
        const seen = new Set();

        for (const q of queries) {
            const url = `${this.baseUrl}/buscar/${encodeURIComponent(q)}/`;
            try {
                const res = await fetch(url, {
                    headers: { "User-Agent": this.userAgent }
                });
                if (!res.ok) continue;

                const html = await res.text();
                const pattern = /class="anime__item__text"[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
                let match;

                while ((match = pattern.exec(html)) !== null) {
                    const href = match[1].trim();
                    const title = match[2].replace(/<[^>]+>/g, "").trim();
                    const id = this._cleanId(href);
                    if (!id || !title || seen.has(id)) continue;
                    seen.add(id);
                    results.push({ id, title, url: `${this.baseUrl}/${id}/`, subOrDub: "sub" });
                }
            } catch (e) {}
            if (results.length > 0) break;
        }

        return results;
    }

    async findEpisodes(id) {
        const url = `${this.baseUrl}/${id}/`;
        const res = await fetch(url, {
            headers: { "User-Agent": this.userAgent }
        });
        if (!res.ok) return [];

        const html = await res.text();
        const episodes = [];
        const seen = new Set();

        const addEp = (number, epId, title) => {
            if (!number || number <= 0 || seen.has(number)) return;
            seen.add(number);
            episodes.push({
                id: epId ?? `${id}/${number}`,
                number,
                url: `${this.baseUrl}/${id}/${number}/`,
                title: title ?? `Episodio ${number}`,
            });
        };

        const seriesIdMatch = html.match(/ajax\/pagination_episodes\/(\d+)\//);
        if (seriesIdMatch) {
            const seriesId = seriesIdMatch[1];
            const totalMatch =
                html.match(/num_episodios\s*=\s*(\d+)/) ??
                html.match(/Episodios:<\/span>[^<]*?(\d+)/) ??
                html.match(/data-episodes="(\d+)"/) ??
                html.match(/num-episodios[^>]*>\s*(\d+)/) ??
                html.match(/(\d+)\s*ep[ií]sodios?/i);

            const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
            const pageCount = total > 0 ? Math.ceil(total / 10) : 1;

            const pageRequests = Array.from({ length: pageCount }, (_, i) =>
                fetch(`${this.baseUrl}/ajax/pagination_episodes/${seriesId}/${i + 1}/`, {
                    headers: {
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": url,
                        "User-Agent": this.userAgent,
                    },
                }).then(r => r.ok ? r.json() : []).catch(() => [])
            );

            const pages = await Promise.all(pageRequests);
            for (const page of pages) {
                if (!Array.isArray(page)) continue;
                for (const ep of page) {
                    const number = parseInt(ep.number ?? ep.num ?? "0", 10);
                    addEp(number, `${id}/${number}`, ep.title);
                }
            }
        }

        if (episodes.length === 0) {
            const totalMatch =
                html.match(/num_episodios\s*=\s*(\d+)/) ??
                html.match(/Episodios:<\/span>[^<]*?(\d+)/) ??
                html.match(/data-episodes="(\d+)"/) ??
                html.match(/num-episodios[^>]*>\s*(\d+)/) ??
                html.match(/(\d+)\s*ep[ií]sodios?/i);
            const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
            for (let i = 1; i <= total; i++) {
                addEp(i);
            }
        }

        return episodes.sort((a, b) => a.number - b.number);
    }

    async _extractJkPlayer(playerUrl) {
        try {
            const res = await fetch(playerUrl, {
                headers: { "Referer": "https://jkanime.net/", "User-Agent": this.userAgent }
            });
            if (!res.ok) return null;
            const html = await res.text();
            const srcMatch = html.match(/<source\s+src=['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i) ||
                             html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
            if (srcMatch) {
                return { url: srcMatch[1], type: "m3u8", quality: "1080p", subtitles: [] };
            }
        } catch (e) {}
        return null;
    }

    async _extractStreamWish(embedUrl) {
        try {
            const res = await fetch(embedUrl, {
                headers: { "Referer": "https://jkanime.net/", "User-Agent": this.userAgent }
            });
            if (!res.ok) return null;
            const html = await res.text();
            const unpacked = this._unpackJs(html) || html;
            const m3u8Match = unpacked.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
            if (m3u8Match) {
                return { url: m3u8Match[1], type: "m3u8", quality: "auto", subtitles: [] };
            }
        } catch (e) {}
        return null;
    }

    async _extractVidhide(embedUrl) {
        try {
            const res = await fetch(embedUrl, {
                headers: { "Referer": "https://jkanime.net/", "User-Agent": this.userAgent }
            });
            if (!res.ok) return null;
            const html = await res.text();
            const unpacked = this._unpackJs(html) || html;
            const m3u8Match = unpacked.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
            if (m3u8Match) {
                return { url: m3u8Match[1], type: "m3u8", quality: "auto", subtitles: [] };
            }
        } catch (e) {}
        return null;
    }

    async _extractMp4Upload(embedUrl) {
        try {
            const res = await fetch(embedUrl, {
                headers: { "Referer": "https://jkanime.net/", "User-Agent": this.userAgent }
            });
            if (!res.ok) return null;
            const html = await res.text();
            const srcMatch = html.match(/src:\s*"([^"]+\.mp4[^"]*)"/i);
            if (srcMatch) {
                return { url: srcMatch[1], type: "mp4", quality: "auto", subtitles: [] };
            }
        } catch (e) {}
        return null;
    }

    async _extractYourUpload(embedUrl) {
        try {
            const res = await fetch(embedUrl, {
                headers: { "Referer": "https://jkanime.net/", "User-Agent": this.userAgent }
            });
            if (!res.ok) return null;
            const html = await res.text();
            const match = html.match(/file:\s*'([^']+\.mp4[^']*)'/i) || html.match(/property="og:video"\s+content="([^"]+)"/i);
            if (match) {
                return { url: match[1], type: "mp4", quality: "auto", subtitles: [] };
            }
        } catch (e) {}
        return null;
    }

    async _extractVoe(embedUrl) {
        try {
            let res = await fetch(embedUrl, {
                headers: { "User-Agent": this.userAgent }
            });
            if (!res.ok) return null;
            let html = await res.text();

            const hop = html.match(/window\.location\.href\s*=\s*'([^']+)'/);
            if (hop && !html.includes("application/json")) {
                res = await fetch(hop[1], {
                    headers: { "Referer": "https://voe.sx/", "User-Agent": this.userAgent }
                });
                if (res.ok) html = await res.text();
            }

            const sourcesMatch = html.match(/var\s+sources\s*=\s*\{[^\}]*"hls"\s*:\s*"([^"]+)"/);
            if (sourcesMatch) {
                return { url: sourcesMatch[1], type: "m3u8", quality: "auto", subtitles: [] };
            }
            const sourceMatch = html.match(/var\s+source\s*=\s*'([^']+)'/);
            if (sourceMatch && !sourceMatch[1].includes("test-videos.co.uk")) {
                return { url: sourceMatch[1], type: "mp4", quality: "auto", subtitles: [] };
            }
        } catch (e) {}
        return null;
    }

    async findEpisodeServer(episode, requestedServer) {
        const epUrl = episode.url || `${this.baseUrl}/${episode.id}/`;
        const res = await fetch(epUrl, {
            headers: { "User-Agent": this.userAgent }
        });
        if (!res.ok) {
            return { server: requestedServer, headers: {}, videoSources: [] };
        }

        const html = await res.text();
        const serversMatch = html.match(/var\s+servers\s*=\s*(\[[\s\S]*?\]);/);
        if (!serversMatch) {
            return { server: requestedServer, headers: {}, videoSources: [] };
        }

        let rawServers = [];
        try {
            rawServers = JSON.parse(serversMatch[1]);
        } catch (e) {
            return { server: requestedServer, headers: {}, videoSources: [] };
        }

        const parsedServers = [];
        for (const s of rawServers) {
            const rawName = (s.server ?? s.name ?? "").trim();
            const normName = this._normalizeServerName(rawName);
            let embedUrl = (s.code ?? s.remote ?? s.url ?? "").trim();

            if (s.remote && typeof s.remote === "string" && !s.remote.startsWith("http")) {
                const decoded = this._b64Decode(s.remote);
                if (decoded && decoded.startsWith("http")) embedUrl = decoded;
            }

            if (!embedUrl) continue;
            const detected = this._detectServerFromUrl(embedUrl);
            const finalName = detected ?? normName;
            parsedServers.push({ name: finalName, embedUrl });
        }

        let target = parsedServers.find(s => s.name.toLowerCase() === requestedServer.toLowerCase());
        if (!target && parsedServers.length > 0) {
            target = parsedServers[0];
        }
        if (!target) {
            return { server: requestedServer, headers: {}, videoSources: [] };
        }

        let source = null;
        switch (target.name) {
            case "JK": source = await this._extractJkPlayer(target.embedUrl); break;
            case "StreamWish": source = await this._extractStreamWish(target.embedUrl); break;
            case "Vidhide": source = await this._extractVidhide(target.embedUrl); break;
            case "Mp4upload": source = await this._extractMp4Upload(target.embedUrl); break;
            case "YourUpload": source = await this._extractYourUpload(target.embedUrl); break;
            case "Voe": source = await this._extractVoe(target.embedUrl); break;
            default: source = await this._extractStreamWish(target.embedUrl) || await this._extractVoe(target.embedUrl); break;
        }

        if (!source) {
            return { server: target.name, headers: {}, videoSources: [] };
        }

        return {
            server: target.name,
            headers: {
                "Referer": "https://jkanime.net/",
                "User-Agent": this.userAgent,
            },
            videoSources: [source],
        };
    }
}
