const API_BASE = "https://anthony-service-api.algienrandomxdd.workers.dev";
const LOCAL_API_BASE = "http://127.0.0.1:3000";

class Provider {
    getSettings() {
        return {
            episodeServers: [
                "Server 1 [Latino]",
                "Server 1 [Castellano]",
                "Server 1 [Sub]"
            ],
            supportsDub: true,
            providerType: "anime",
        };
    }

    _detectDialect(serverName) {
        const s = (serverName || "").toLowerCase();
        if (s.includes("latino") || s.includes("lat") || s.includes("es-419")) {
            return "latino";
        }
        if (s.includes("castellano") || s.includes("cast") || s.includes("es-es") || s.includes("spain") || s.includes("españa")) {
            return "castellano";
        }
        return "sub";
    }

    async _resolveByseraguci(code, serverLabel) {
        try {
            const pRes = await fetch(`https://byseraguci.com/api/videos/${code}`, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    "Referer": `https://byseraguci.com/e/${code}`,
                    "Origin": "https://byseraguci.com"
                }
            });
            if (!pRes.ok) return null;
            const pData = await pRes.json();
            if (!pData || !pData.playback) return null;

            const decRes = await fetch(`${API_BASE}/decrypt-playback`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(pData.playback)
            });
            if (!decRes.ok) return null;
            const decData = await decRes.json();
            if (!decData || !decData.url) return null;

            return {
                server: serverLabel,
                headers: {},
                videoSources: [
                    {
                        url: decData.url,
                        type: "m3u8",
                        quality: "auto",
                        subtitles: []
                    }
                ]
            };
        } catch (err) {
            console.error("[EspAnime] Error resolviendo byseraguci:", err);
            return null;
        }
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
                title: item.title_english || item.title,
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
                title: ep.code ? `${ep.code} · Episodio ${ep.num}` : `Episodio ${ep.num}`,
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
        const targetServer = (server || "").trim();
        const dialect = this._detectDialect(targetServer);

        // 1. Obtener lista de players (delta / byseraguci)
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

        const matchedPlayer = players.find(p =>
            (p.lang && p.lang.toLowerCase() === dialect) ||
            (targetServer && p.server && p.server.toLowerCase() === targetServer.toLowerCase())
        );

        if (matchedPlayer && matchedPlayer.sid === 2 && matchedPlayer.code) {
            const resolved = await this._resolveByseraguci(matchedPlayer.code, matchedPlayer.server || targetServer);
            if (resolved) return resolved;
        }

        // 2. Consultar /streams del Worker (HLS directos o delta)
        let streams = [];
        try {
            const res = await fetch(`${API_BASE}/streams?animeId=${encodeURIComponent(animeId)}&ep=${epNum}&lang=${encodeURIComponent(dialect)}`);
            if (res.ok) {
                const data = await res.json();
                streams = data.streams || [];
            }
            if (streams.length === 0) {
                const allRes = await fetch(`${API_BASE}/streams?animeId=${encodeURIComponent(animeId)}&ep=${epNum}`);
                if (allRes.ok) {
                    const allData = await allRes.json();
                    streams = allData.streams || [];
                }
            }
        } catch (workerErr) {
            console.warn("[EspAnime] Error consultando /streams:", workerErr);
        }

        const directHls = streams.find(s => s.kind === "hls" && s.url);
        if (directHls) {
            return {
                server: directHls.server || targetServer,
                headers: directHls.headers || {},
                videoSources: [
                    {
                        url: directHls.url,
                        type: directHls.url.includes(".mp4") ? "mp4" : "m3u8",
                        quality: directHls.quality || "auto",
                        subtitles: []
                    }
                ]
            };
        }

        for (const s of streams) {
            if (s.source === "delta" && s.url) {
                const m = s.url.match(/\/e\/([A-Za-z0-9]+)/);
                if (m) {
                    const resolved = await this._resolveByseraguci(m[1], s.server || targetServer);
                    if (resolved) return resolved;
                }
            }
        }

        // 3. Fallback a cualquier player disponible si no hubo coincidencia exacta de idioma
        for (const p of players) {
            if (p.sid === 2 && p.code) {
                const resolved = await this._resolveByseraguci(p.code, p.server || targetServer);
                if (resolved) return resolved;
            }
        }

        // 4. Fallback opcional al servidor local si está corriendo
        try {
            const localRes = await fetch(`${LOCAL_API_BASE}/api/sources?tvdb_id=${encodeURIComponent(animeId)}&season=1&ep=${epNum}`);
            if (localRes.ok) {
                const localData = await localRes.json();
                const srvList = (localData.sources && localData.sources[dialect]) || [];
                for (const s of srvList) {
                    if (s.source === "animeav1" && s.url) {
                        const av1Res = await fetch(`${LOCAL_API_BASE}/api/av1/resolve?url=${encodeURIComponent(s.url)}`);
                        if (av1Res.ok) {
                            const av1Data = await av1Res.json();
                            if (av1Data.sources && av1Data.sources.length > 0) {
                                return {
                                    server: `${targetServer} (Local AV1)`,
                                    headers: av1Data.headers || {},
                                    videoSources: av1Data.sources
                                };
                            }
                        }
                    }
                }
            }
        } catch (fallbackErr) {
            // Fallback local opcional
        }

        throw new Error(`[EspAnime] No hay streams reproducibles para el episodio ${epNum} (${dialect}).`);
    }
}
