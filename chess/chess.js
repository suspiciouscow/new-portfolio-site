(function () {
    const FILES = "abcdefgh";
    const MIKI_ELO = 1200;
    // Stockfish Skill Level ~3 plays in the ~1100–1300 range with short think time
    const SKILL_LEVEL = 3;
    const MOVE_TIME_MS = 700;

    function pieceSrc(piece) {
        if (!piece) return "";
        return "pieces/" + piece.color + piece.type.toUpperCase() + ".svg";
    }

    function pieceSrcFromParts(color, type) {
        return "pieces/" + color + type.toUpperCase() + ".svg";
    }

    const boardEl = document.getElementById("board");
    const statusEl = document.getElementById("status");
    const engineStateEl = document.getElementById("engineState");
    const newGameBtn = document.getElementById("newGame");
    const undoBtn = document.getElementById("undo");
    const capturesTopEl = document.getElementById("capturesTop");
    const capturesBottomEl = document.getElementById("capturesBottom");

    const PIECE_ORDER = { q: 0, r: 1, b: 2, n: 3, p: 4 };
    const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

    const game = new Chess();
    let selected = null;
    let legalTargets = [];
    let lastMove = null;
    let thinking = false;
    let engineReady = false;
    let engine = null;
    let engineMode = "fallback";
    let pendingResolve = null;

    function squareName(rank, file) {
        return FILES[file] + (8 - rank);
    }

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function updateUndo() {
        undoBtn.disabled = thinking || game.history().length === 0;
    }

    function gameOverMessage() {
        if (game.in_checkmate()) {
            return game.turn() === "w" ? "Checkmate — Miki wins." : "Checkmate — you win.";
        }
        if (game.in_draw()) {
            if (game.in_stalemate()) return "Draw — stalemate.";
            if (game.in_threefold_repetition()) return "Draw — repetition.";
            if (game.insufficient_material()) return "Draw — insufficient material.";
            return "Draw.";
        }
        return null;
    }

    function getCapturedPieces() {
        // captured.w = white pieces taken by black (shown near Miki / top? )
        // User is white at bottom. Convention:
        // Top (near black): pieces white captured (black pieces)
        // Bottom (near white): pieces black captured (white pieces)
        const byColor = { w: [], b: [] };
        const history = game.history({ verbose: true });
        for (const move of history) {
            if (!move.captured) continue;
            const capturedColor = move.color === "w" ? "b" : "w";
            byColor[capturedColor].push(move.captured);
        }
        byColor.w.sort((a, b) => PIECE_ORDER[a] - PIECE_ORDER[b]);
        byColor.b.sort((a, b) => PIECE_ORDER[a] - PIECE_ORDER[b]);
        return byColor;
    }

    function materialScore(types) {
        return types.reduce((sum, t) => sum + (PIECE_VALUE[t] || 0), 0);
    }

    function renderCaptures() {
        const captured = getCapturedPieces();
        // Top: black pieces you took
        // Bottom: white pieces Miki took
        fillCaptureTray(capturesTopEl, "b", captured.b, materialScore(captured.b) - materialScore(captured.w));
        fillCaptureTray(capturesBottomEl, "w", captured.w, materialScore(captured.w) - materialScore(captured.b));
    }

    function fillCaptureTray(el, color, types, advantage) {
        el.innerHTML = "";
        types.forEach((type) => {
            const img = document.createElement("img");
            img.src = pieceSrcFromParts(color, type);
            img.alt = color === "w" ? "Captured white " + type : "Captured black " + type;
            img.draggable = false;
            el.appendChild(img);
        });
        if (advantage > 0) {
            const adv = document.createElement("span");
            adv.className = "chess-captures-advantage";
            adv.textContent = "+" + advantage;
            el.appendChild(adv);
        }
    }

    function render() {
        const over = gameOverMessage();
        boardEl.innerHTML = "";

        for (let rank = 0; rank < 8; rank++) {
            for (let file = 0; file < 8; file++) {
                const name = squareName(rank, file);
                const sq = document.createElement("button");
                sq.type = "button";
                sq.className = "square " + ((rank + file) % 2 === 0 ? "light" : "dark");
                sq.dataset.square = name;
                sq.setAttribute("aria-label", name);

                if (lastMove && (name === lastMove.from || name === lastMove.to)) {
                    sq.classList.add("last-move");
                }
                if (selected === name) sq.classList.add("selected");
                if (legalTargets.includes(name)) {
                    sq.classList.add("legal");
                    const target = game.get(name);
                    if (target) sq.classList.add("capture");
                }

                const piece = game.get(name);
                if (piece) {
                    const img = document.createElement("img");
                    img.className = "piece";
                    img.src = pieceSrc(piece);
                    img.alt = piece.color === "w" ? "White " + piece.type : "Black " + piece.type;
                    img.draggable = false;
                    sq.appendChild(img);

                    if (piece.type === "k" && game.in_check() && piece.color === game.turn()) {
                        sq.classList.add("check");
                    }

                    if (!thinking && !over && piece.color === "w" && game.turn() === "w") {
                        sq.classList.add("movable");
                    }
                }

                sq.addEventListener("click", () => onSquareClick(name));
                boardEl.appendChild(sq);
            }
        }

        renderCaptures();

        if (over) {
            setStatus(over);
        } else if (thinking) {
            setStatus("Miki is thinking…");
        } else if (game.turn() === "w") {
            setStatus(game.in_check() ? "Your turn — check!" : "Your turn — you play white.");
        } else {
            setStatus("Miki's turn…");
        }

        updateUndo();
    }

    function clearSelection() {
        selected = null;
        legalTargets = [];
    }

    function onSquareClick(name) {
        if (thinking || game.game_over() || game.turn() !== "w") return;

        const piece = game.get(name);

        if (selected) {
            if (legalTargets.includes(name)) {
                const move = game.move({
                    from: selected,
                    to: name,
                    promotion: "q"
                });
                if (move) {
                    lastMove = { from: move.from, to: move.to };
                    clearSelection();
                    render();
                    if (!game.game_over()) {
                        window.setTimeout(mikiMove, 250);
                    }
                    return;
                }
            }

            if (piece && piece.color === "w") {
                selected = name;
                legalTargets = game.moves({ square: name, verbose: true }).map((m) => m.to);
                render();
                return;
            }

            clearSelection();
            render();
            return;
        }

        if (piece && piece.color === "w") {
            selected = name;
            legalTargets = game.moves({ square: name, verbose: true }).map((m) => m.to);
            render();
        }
    }

    // --- Fallback ~1200 engine (depth-limited with intentional noise) ---
    const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

    const PST = {
        p: [
            0, 0, 0, 0, 0, 0, 0, 0,
            50, 50, 50, 50, 50, 50, 50, 50,
            10, 10, 20, 30, 30, 20, 10, 10,
            5, 5, 10, 25, 25, 10, 5, 5,
            0, 0, 0, 20, 20, 0, 0, 0,
            5, -5, -10, 0, 0, -10, -5, 5,
            5, 10, 10, -20, -20, 10, 10, 5,
            0, 0, 0, 0, 0, 0, 0, 0
        ],
        n: [
            -50, -40, -30, -30, -30, -30, -40, -50,
            -40, -20, 0, 0, 0, 0, -20, -40,
            -30, 0, 10, 15, 15, 10, 0, -30,
            -30, 5, 15, 20, 20, 15, 5, -30,
            -30, 0, 15, 20, 20, 15, 0, -30,
            -30, 5, 10, 15, 15, 10, 5, -30,
            -40, -20, 0, 5, 5, 0, -20, -40,
            -50, -40, -30, -30, -30, -30, -40, -50
        ],
        b: [
            -20, -10, -10, -10, -10, -10, -10, -20,
            -10, 0, 0, 0, 0, 0, 0, -10,
            -10, 0, 5, 10, 10, 5, 0, -10,
            -10, 5, 5, 10, 10, 5, 5, -10,
            -10, 0, 10, 10, 10, 10, 0, -10,
            -10, 10, 10, 10, 10, 10, 10, -10,
            -10, 5, 0, 0, 0, 0, 5, -10,
            -20, -10, -10, -10, -10, -10, -10, -20
        ],
        r: [
            0, 0, 0, 0, 0, 0, 0, 0,
            5, 10, 10, 10, 10, 10, 10, 5,
            -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5,
            -5, 0, 0, 0, 0, 0, 0, -5,
            0, 0, 0, 5, 5, 0, 0, 0
        ],
        q: [
            -20, -10, -10, -5, -5, -10, -10, -20,
            -10, 0, 0, 0, 0, 0, 0, -10,
            -10, 0, 5, 5, 5, 5, 0, -10,
            -5, 0, 5, 5, 5, 5, 0, -5,
            0, 0, 5, 5, 5, 5, 0, -5,
            -10, 5, 5, 5, 5, 5, 0, -10,
            -10, 0, 5, 0, 0, 0, 0, -10,
            -20, -10, -10, -5, -5, -10, -10, -20
        ],
        k: [
            -30, -40, -40, -50, -50, -40, -40, -30,
            -30, -40, -40, -50, -50, -40, -40, -30,
            -30, -40, -40, -50, -50, -40, -40, -30,
            -30, -40, -40, -50, -50, -40, -40, -30,
            -20, -30, -30, -40, -40, -30, -30, -20,
            -10, -20, -20, -20, -20, -20, -20, -10,
            20, 20, 0, 0, 0, 0, 20, 20,
            20, 30, 10, 0, 0, 10, 30, 20
        ]
    };

    function squareIndex(square, color) {
        const file = FILES.indexOf(square[0]);
        const rank = Number(square[1]) - 1;
        const idx = (7 - rank) * 8 + file;
        return color === "w" ? idx : 63 - idx;
    }

    function evaluatePosition(g) {
        let score = 0;
        const board = g.board();
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const p = board[r][f];
                if (!p) continue;
                const sq = FILES[f] + (8 - r);
                const val = VALUES[p.type] + (PST[p.type][squareIndex(sq, p.color)] || 0);
                score += p.color === "b" ? val : -val;
            }
        }
        return score;
    }

    function minimax(g, depth, alpha, beta, maximizing) {
        if (depth === 0 || g.game_over()) {
            if (g.in_checkmate()) return maximizing ? -99999 : 99999;
            if (g.in_draw()) return 0;
            return evaluatePosition(g);
        }

        const moves = g.moves({ verbose: true });
        if (maximizing) {
            let best = -Infinity;
            for (const move of moves) {
                g.move(move);
                best = Math.max(best, minimax(g, depth - 1, alpha, beta, false));
                g.undo();
                alpha = Math.max(alpha, best);
                if (beta <= alpha) break;
            }
            return best;
        }

        let best = Infinity;
        for (const move of moves) {
            g.move(move);
            best = Math.min(best, minimax(g, depth - 1, alpha, beta, true));
            g.undo();
            beta = Math.min(beta, best);
            if (beta <= alpha) break;
        }
        return best;
    }

    function fallbackMove() {
        const moves = game.moves({ verbose: true });
        if (!moves.length) return null;

        const scored = moves.map((move) => {
            game.move(move);
            const score = minimax(game, 2, -Infinity, Infinity, false);
            game.undo();
            return { move, score };
        });

        scored.sort((a, b) => b.score - a.score);

        // ~1200 flavor: usually pick near the top, sometimes a soft mistake
        const roll = Math.random();
        let pool;
        if (roll < 0.08 && scored.length > 4) {
            pool = scored.slice(Math.floor(scored.length * 0.35), Math.floor(scored.length * 0.7));
        } else {
            const best = scored[0].score;
            pool = scored.filter((s) => best - s.score <= 45);
            if (pool.length === 0) pool = scored.slice(0, 3);
        }

        return pool[Math.floor(Math.random() * pool.length)].move;
    }

    // --- Stockfish (preferred when the worker loads) ---
    function createStockfishWorker(scriptUrl) {
        const blob = new Blob(
            [`importScripts(${JSON.stringify(scriptUrl)});`],
            { type: "application/javascript" }
        );
        return new Worker(URL.createObjectURL(blob));
    }

    function initEngine() {
        return new Promise((resolve) => {
            const urls = [
                "https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js",
                "https://unpkg.com/stockfish.js@10.0.2/stockfish.js"
            ];

            let idx = 0;

            function useFallback() {
                engineMode = "fallback";
                engineReady = true;
                engineStateEl.textContent = `Opponent strength ≈ ${MIKI_ELO}`;
                resolve();
            }

            function tryNext() {
                if (idx >= urls.length) {
                    useFallback();
                    return;
                }

                const url = urls[idx++];
                let worker;
                try {
                    worker = createStockfishWorker(url);
                } catch (err) {
                    tryNext();
                    return;
                }

                let settled = false;
                const timeout = window.setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    try { worker.terminate(); } catch (e) { /* ignore */ }
                    tryNext();
                }, 5000);

                worker.onmessage = function (event) {
                    const line = String(event.data || "");

                    if (!settled && line.includes("uciok")) {
                        settled = true;
                        window.clearTimeout(timeout);
                        engine = worker;
                        engineMode = "stockfish";
                        engineReady = true;
                        worker.postMessage("setoption name Skill Level value " + SKILL_LEVEL);
                        worker.postMessage("setoption name Contempt value 0");
                        worker.postMessage("isready");
                        engineStateEl.textContent = `Opponent strength ≈ ${MIKI_ELO}`;
                        resolve();
                        return;
                    }

                    if (line.startsWith("bestmove") && pendingResolve) {
                        const parts = line.split(" ");
                        const best = parts[1];
                        const resolveMove = pendingResolve;
                        pendingResolve = null;
                        resolveMove(best && best !== "(none)" ? best : null);
                    }
                };

                worker.onerror = function () {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timeout);
                    try { worker.terminate(); } catch (e) { /* ignore */ }
                    tryNext();
                };

                worker.postMessage("uci");
            }

            tryNext();
        });
    }

    function askStockfish() {
        return new Promise((resolve) => {
            if (!engine) {
                resolve(null);
                return;
            }
            pendingResolve = resolve;
            engine.postMessage("position fen " + game.fen());
            engine.postMessage("go movetime " + MOVE_TIME_MS);
            window.setTimeout(() => {
                if (pendingResolve === resolve) {
                    pendingResolve = null;
                    resolve(null);
                }
            }, MOVE_TIME_MS + 2500);
        });
    }

    async function mikiMove() {
        if (game.game_over() || game.turn() !== "b") return;

        thinking = true;
        clearSelection();
        render();

        let move = null;

        if (engineMode === "stockfish" && engine) {
            const uci = await askStockfish();
            if (uci && uci.length >= 4) {
                move = {
                    from: uci.slice(0, 2),
                    to: uci.slice(2, 4),
                    promotion: uci.length > 4 ? uci[4] : "q"
                };
            }
        }

        if (!move) {
            // Yield so the "thinking" status paints before the sync search
            await new Promise((r) => window.setTimeout(r, 40));
            move = fallbackMove();
        }

        if (move) {
            const played = game.move(move);
            if (played) {
                lastMove = { from: played.from, to: played.to };
            }
        }

        thinking = false;
        render();
    }

    function resetGame() {
        game.reset();
        selected = null;
        legalTargets = [];
        lastMove = null;
        thinking = false;
        render();
    }

    function undoTurn() {
        if (thinking || game.history().length === 0) return;
        game.undo();
        if (game.history().length > 0 && game.turn() === "b") {
            game.undo();
        }
        lastMove = null;
        const history = game.history({ verbose: true });
        if (history.length) {
            const m = history[history.length - 1];
            lastMove = { from: m.from, to: m.to };
        }
        clearSelection();
        render();
    }

    newGameBtn.addEventListener("click", resetGame);
    undoBtn.addEventListener("click", undoTurn);

    render();
    initEngine().then(() => {
        if (!engineReady) return;
        if (engineMode === "fallback") {
            engineStateEl.textContent = `Opponent strength ≈ ${MIKI_ELO}`;
        }
    });
})();
