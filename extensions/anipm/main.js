const BASE_URL = "https://ani.pm";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

class Provider {
    getSettings() {
        return {
            episodeServers: ["AniPM (Sub)", "AniPM (Dub)"],
            supportsDub: true,
        };
    }

    async doFetch(url, extraHeaders) {
        const headers = {
            "User-Agent": UA,
            "Referer": `${BASE_URL}/`,
        };
        if (extraHeaders) {
            for (const [k, v] of Object.entries(extraHeaders)) {
                headers[k] = v;
            }
        }
        const res = await fetch(url, { headers });
        if (!res) throw new Error(`Fetch returned undefined for ${url}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.text();
    }

    async search(opts) {
        if (opts.media && opts.media.id) {
            try {
                const lookupRaw = await this.doFetch(`${BASE_URL}/api/partner/v1/lookup?anilist=${opts.media.id}`);
                const lookupData = JSON.parse(lookupRaw);
                const item = lookupData.data && lookupData.data[0];
                if (item && item.available) {
                    return [{
                        id: String(item.anilistId),
                        title: item.title || opts.media.romajiTitle || opts.query,
                        url: `https://ani.pm/ani/${item.anilistId}`,
                        subOrDub: (item.episodes && item.episodes.dub > 0) ? "both" : "sub"
                    }];
                }
            } catch (_) {}
        }

        if (opts.media && opts.media.idMal) {
            try {
                const lookupRaw = await this.doFetch(`${BASE_URL}/api/partner/v1/lookup?mal=${opts.media.idMal}`);
                const lookupData = JSON.parse(lookupRaw);
                const item = lookupData.data && lookupData.data[0];
                if (item && item.available) {
                    return [{
                        id: String(item.anilistId || item.malId),
                        title: item.title || opts.media.romajiTitle || opts.query,
                        url: `https://ani.pm/ani/${item.anilistId}`,
                        subOrDub: (item.episodes && item.episodes.dub > 0) ? "both" : "sub"
                    }];
                }
            } catch (_) {}
        }

        try {
            const query = opts.query || (opts.media && (opts.media.romajiTitle || opts.media.englishTitle)) || "";
            if (!query || query.length < 2) return [];

            const titlesRaw = await this.doFetch(`${BASE_URL}/api/partner/v1/titles?q=${encodeURIComponent(query)}`);
            const titlesData = JSON.parse(titlesRaw);
            if (!titlesData.data || !Array.isArray(titlesData.data)) return [];

            return titlesData.data.map(item => ({
                id: String(item.anilistId || item.malId),
                title: item.title,
                url: item.url || `https://ani.pm/ani/${item.anilistId}`,
                subOrDub: (item.episodes && item.episodes.dub > 0) ? "both" : "sub"
            }));
        } catch (e) {
            console.error(`[AniPM] Titles search error: ${e.message}`);
            return [];
        }
    }

    async findEpisodes(id) {
        try {
            const raw = await this.doFetch(`${BASE_URL}/api/partner/v1/series/${id}`);
            const res = JSON.parse(raw);
            const episodeList = res.data && res.data.episodeList;
            if (!episodeList || !Array.isArray(episodeList)) return [];

            return episodeList.map(ep => ({
                id: `${id}$${ep.number}`,
                number: ep.number,
                url: `https://ani.pm/embed/ani/${id}/${ep.number}/sub`,
                title: ep.title ? `Episodio ${ep.number} - ${ep.title}` : `Episodio ${ep.number}`
            }));
        } catch (e) {
            console.error(`[AniPM] findEpisodes error: ${e.message}`);
            return [];
        }
    }

    async findEpisodeServer(episode, server) {
        const parts = episode.id.split("$");
        const anilistId = parts[0];
        const epNum = parts[1] || String(episode.number);
        const isDub = server && server.toLowerCase().includes("dub");
        const lang = isDub ? "dub" : "sub";

        const embedUrl = `${BASE_URL}/embed/ani/${anilistId}/${epNum}/${lang}`;
        const embedHtml = await this.doFetch(embedUrl, { "Referer": `${BASE_URL}/` });
        const configMatch = embedHtml.match(/id="anipm-embed-config">([^<]+)<\/script>/);
        if (!configMatch) throw new Error("[AniPM] Embed config nonce not found");

        const embedConfig = JSON.parse(configMatch[1]);
        const nonce = embedConfig.nonce;
        if (!nonce) throw new Error("[AniPM] Nonce was missing");

        const sessionUrl = `${BASE_URL}/api/partner/v1/session?n=${encodeURIComponent(nonce)}&id=${anilistId}&ep=${epNum}&lang=${lang}&hardsub=0&adult=1`;
        const sessionRaw = await this.doFetch(sessionUrl, { "Referer": `${BASE_URL}/` });
        const sessionData = JSON.parse(sessionRaw);
        const token = sessionData.token;
        if (!token) throw new Error("[AniPM] No session token");

        const settlarUrl = `https://embed.settlar.io/api/embed/session?t=${encodeURIComponent(token)}`;
        const settlarRaw = await this.doFetch(settlarUrl, {
            "Referer": "https://embed.settlar.io/",
            "Accept": "application/json"
        });
        const settlarData = JSON.parse(settlarRaw);
        if (!settlarData.source) throw new Error("[AniPM] No video stream URL");

        const subtitles = (settlarData.subtitles || []).map(sub => ({
            id: sub.srclang || sub.label,
            url: sub.url,
            language: sub.label || sub.srclang || "Unknown",
            isDefault: !!sub.default || sub.srclang === "es" || sub.srclang === "en"
        }));

        return {
            server: server || (isDub ? "AniPM (Dub)" : "AniPM (Sub)"),
            headers: {
                "Referer": "https://embed.settlar.io/",
                "User-Agent": UA
            },
            videoSources: [
                {
                    url: settlarData.source,
                    type: "m3u8",
                    quality: "auto",
                    label: isDub ? "Dub" : "Sub",
                    subtitles: subtitles
                }
            ]
        };
    }
}
