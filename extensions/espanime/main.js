const API_BASE = "https://aniting-api.algienrandomxdd.workers.dev";

class Provider {
    getSettings() {
        return {
            episodeServers: ["Server 1 [Sub]", "Server 1 [Latino]", "Server 1 [Castellano]"],
            supportsDub: true,
            providerType: "anime",
        };
    }

    async search(opts) {
        const media = opts.media;
        const query = (opts.query || (media && (media.romajiTitle || media.englishTitle)) || "").trim();
        if (!query) return [];

        try {
            const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.results || []).map(item => ({
                id: String(item.id),
                title: item.title,
                url: `${API_BASE}/episodes?animeId=${item.id}`,
                subOrDub: "both"
            }));
        } catch (err) {
            console.error("[EspAnime] search error:", err);
            return [];
        }
    }

    async findEpisodes(id) {
        try {
            const res = await fetch(`${API_BASE}/episodes?animeId=${encodeURIComponent(id)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.episodes || []).map(ep => ({
                id: `${id}$${ep.num}`,
                number: ep.num,
                title: `Episodio ${ep.num}`,
                url: `${API_BASE}/streams?animeId=${encodeURIComponent(id)}&ep=${ep.num}`
            }));
        } catch (err) {
            console.error("[EspAnime] findEpisodes error:", err);
            return [];
        }
    }

    async findEpisodeServer(episode, server) {
        const parts = episode.id.split("$");
        const animeId = parts[0];
        const epNum = parts[1] || episode.number || 1;

        // 1. Obtener lista de servidores disponibles
        let players = [];
        try {
            const res = await fetch(`${API_BASE}/players?animeId=${encodeURIComponent(animeId)}&ep=${epNum}`);
            if (res.ok) {
                const data = await res.json();
                players = data.players || [];
            }
        } catch (e) {
            console.error("[EspAnime] Error obteniendo /players:", e);
        }

        const targetServer = (server || "").trim();
        let chosen = null;
        if (targetServer && players.length > 0) {
            chosen = players.find(p => p.server.toLowerCase() === targetServer.toLowerCase());
        }
        if (!chosen && players.length > 0) {
            chosen = players[0];
        }

        // 2. Extracción directa residencial para Filemoon (sid 2)
        if (chosen && chosen.sid === 2 && chosen.code) {
            try {
                const pRes = await fetch(`https://byseraguci.com/api/videos/${chosen.code}`, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                        "Referer": `https://byseraguci.com/e/${chosen.code}`,
                        "Origin": "https://byseraguci.com"
                    }
                });
                if (pRes.ok) {
                    const pData = await pRes.json();
                    if (pData && pData.playback) {
                        const decRes = await fetch(`${API_BASE}/decrypt-playback`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(pData.playback)
                        });
                        if (decRes.ok) {
                            const decData = await decRes.json();
                            if (decData.url) {
                                return {
                                    server: chosen.server,
                                    headers: {},
                                    videoSources: [
                                        {
                                            url: decData.url,
                                            type: "m3u8",
                                            quality: "1080p",
                                            subtitles: []
                                        }
                                    ]
                                };
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("[EspAnime] Error en extracción directa Filemoon:", err);
            }
        }

        // 3. Fallback: streams del Worker
        let queryUrl = `${API_BASE}/streams?animeId=${encodeURIComponent(animeId)}&ep=${epNum}`;
        if (targetServer) {
            queryUrl += `&server=${encodeURIComponent(targetServer)}`;
        }

        const res = await fetch(queryUrl);
        if (!res.ok) {
            throw new Error(`[EspAnime] Error HTTP ${res.status} al consultar streams`);
        }

        const data = await res.json();
        const streams = data.streams || [];
        if (streams.length === 0) {
            throw new Error(`[EspAnime] No hay streams disponibles para el episodio ${epNum}`);
        }

        let chosenStream = null;
        if (targetServer) {
            chosenStream = streams.find(s => s.server.toLowerCase() === targetServer.toLowerCase());
        }
        if (!chosenStream) {
            chosenStream = streams[0];
        }

        return {
            server: chosenStream.server,
            headers: chosenStream.headers || {},
            videoSources: [
                {
                    url: chosenStream.url,
                    type: "m3u8",
                    quality: chosenStream.quality || "1080p",
                    subtitles: []
                }
            ]
        };
    }
}
