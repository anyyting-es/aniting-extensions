function cfg(value, fallback) {
    if (!value || value.indexOf("{{") === 0) {
        return fallback;
    }
    return value.replace(/\/$/, "");
}

class Provider {
    constructor() {
        this.proxy = cfg("https://reanime.sharky.systems", "https://reanime.sharky.systems");
        this.apiKey = cfg("", "");
    }

    getSettings() {
        return {
            episodeServers: ["Auto", "HD-1", "HD-2"],
            supportsDub: true,
        };
    }

    headers() {
        const out = { "Accept": "application/json" };
        if (this.apiKey) {
            out["X-API-Key"] = this.apiKey;
        }
        return out;
    }

    async search(opts) {
        const media = opts.media;
        const title = (media && (media.englishTitle || media.romajiTitle)) || opts.query;
        const mal = (media && media.idMal) ? String(media.idMal) : "";
        const eps = (media && media.episodeCount) ? String(media.episodeCount) : "0";
        const audio = opts.dub ? "dub" : "sub";
        const id = media && media.id ? media.id : 0;
        return [{
            id: "ani:" + id + "|mal:" + mal + "|eps:" + eps + "|aud:" + audio,
            title: title,
            url: this.proxy + "/s/ani/" + id + "/1/" + audio + ".m3u8",
            subOrDub: audio,
        }];
    }

    async findEpisodes(id) {
        const parsed = this.parseId(id);
        const qs = "anilistId=" + encodeURIComponent(parsed.ani) +
            "&malId=" + encodeURIComponent(parsed.mal) +
            "&lang=" + encodeURIComponent(parsed.audio);
        const req = await fetch(this.proxy + "/api/episodes?" + qs, { headers: this.headers() });
        if (!req.ok) {
            return this.syntheticEpisodes(parsed);
        }
        let data = null;
        try {
            data = await req.json();
        } catch (_err) {
            return this.syntheticEpisodes(parsed);
        }
        if (!data || !data.ok) {
            return this.syntheticEpisodes(parsed);
        }
        const ref = parsed;
        return (data.episodes || []).map(function (episode) {
            return {
                id: "ani:" + ref.ani + "|mal:" + ref.mal + "|ep:" + episode.number + "|aud:" + ref.audio,
                number: episode.number,
                title: episode.title,
                url: episode.url,
            };
        });
    }

    async findEpisodeServer(episode, server) {
        const parsed = this.parseId(episode.id);
        const ep = parsed.ep || episode.number;
        if (!parsed.ani) {
            throw new Error("missing AniList id on episode; search the title again from AniList");
        }
        let url = this.proxy + "/api/resolve/ani/" + parsed.ani + "/" + ep + "/" + parsed.audio;
        if (server && server !== "Auto" && server !== "default") {
            url += "?server=" + encodeURIComponent(server);
        }
        const req = await fetch(url, { headers: this.headers() });
        if (!req.ok) {
            let detail = "";
            try {
                const body = await req.json();
                detail = (body && body.error) || "";
            } catch (e) {
                detail = "";
            }
            if (detail) {
                throw new Error(detail);
            }
            throw new Error("Reanime proxy HTTP " + req.status + ". Start reanime_proxy.py and confirm " + this.proxy + " is reachable.");
        }
        const data = await req.json();
        if (!data || !data.ok || !data.streamUrl) {
            throw new Error((data && data.error) || "Reanime proxy did not return a stream URL.");
        }
        const tracks = data.subtitles || [];
        const subs = tracks.map(function (track) {
            return {
                id: track.id,
                url: track.url,
                language: track.language,
                isDefault: track.isDefault,
            };
        });
        const type = data.type === "mp4" ? "mp4" : "m3u8";
        const levels = (data.qualities && data.qualities.length) ? data.qualities : [];
        const sep = data.streamUrl.indexOf("?") === -1 ? "?" : "&";
        const sources = [{
            url: data.streamUrl,
            type: type,
            quality: "auto",
            subtitles: subs,
        }];
        levels.forEach(function (q) {
            sources.push({
                url: data.streamUrl + sep + "quality=" + encodeURIComponent(q),
                type: type,
                quality: q,
                subtitles: subs,
            });
        });
        return {
            server: server || data.server || "Auto",
            headers: {},
            videoSources: sources,
        };
    }

    syntheticEpisodes(parsed) {
        const count = parsed.eps > 0 ? parsed.eps : 12;
        const episodes = [];
        for (let number = 1; number <= count; number++) {
            episodes.push({
                id: "ani:" + parsed.ani + "|mal:" + parsed.mal + "|ep:" + number + "|aud:" + parsed.audio,
                number: number,
                title: "Episode " + number,
                url: this.proxy + "/s/ani/" + parsed.ani + "/" + number + "/" + parsed.audio + ".m3u8",
            });
        }
        return episodes;
    }

    parseId(id) {
        const aniMatch = id.match(/ani:(\d+)/) || id.match(/^(\d+)/);
        const malMatch = id.match(/mal:(\d+)/);
        const epMatch = id.match(/ep:(\d+)/);
        const epsMatch = id.match(/eps:(\d+)/);
        const audMatch = id.match(/aud:(sub|dub)/);
        return {
            ani: aniMatch ? aniMatch[1] : "",
            mal: malMatch ? malMatch[1] : "",
            ep: parseInt(epMatch ? epMatch[1] : "0", 10),
            eps: parseInt(epsMatch ? epsMatch[1] : "0", 10),
            audio: audMatch ? audMatch[1] : "sub",
        };
    }
}
