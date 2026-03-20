// ===================================================
// NINE MEN'S MORRIS (MŁYNEK) — Game Engine & AI
// ===================================================

const EMPTY = 0, WHITE = 1, BLACK = 2;
const TOTAL_PIECES = 9;

// SVG coordinates for 24 board positions (viewBox 0 0 420 420)
const POS_COORDS = [
    [30, 30], [210, 30], [390, 30], [390, 210], [390, 390], [210, 390], [30, 390], [30, 210],
    [90, 90], [210, 90], [330, 90], [330, 210], [330, 330], [210, 330], [90, 330], [90, 210],
    [150, 150], [210, 150], [270, 150], [270, 210], [270, 270], [210, 270], [150, 270], [150, 210]
];

const ADJACENCY = [
    [1, 7], [0, 2, 9], [1, 3], [2, 4, 11], [3, 5], [4, 6, 13], [5, 7], [6, 0, 15],
    [9, 15], [8, 10, 1, 17], [9, 11], [10, 12, 3, 19], [11, 13], [12, 14, 5, 21], [13, 15], [14, 8, 7, 23],
    [17, 23], [16, 18, 9], [17, 19], [18, 20, 11], [19, 21], [20, 22, 13], [21, 23], [22, 16, 15]
];

const MILLS = [
    [0, 1, 2], [8, 9, 10], [16, 17, 18], [4, 5, 6], [12, 13, 14], [20, 21, 22],
    [0, 7, 6], [8, 15, 14], [16, 23, 22], [2, 3, 4], [10, 11, 12], [18, 19, 20],
    [1, 9, 17], [3, 11, 19], [5, 13, 21], [7, 15, 23]
];

// Pre-compute which mills each position belongs to
const POSITION_MILLS = Array.from({ length: 24 }, (_, i) =>
    MILLS.reduce((acc, mill, idx) => { if (mill.includes(i)) acc.push(idx); return acc; }, [])
);

const AI_DEPTH = { easy: 2, medium: 4, hard: 5 };

// ---- Game State ----
let game = null;

function createGameState(difficulty) {
    return {
        board: new Array(24).fill(EMPTY),
        currentPlayer: WHITE,
        piecesPlaced: { [WHITE]: 0, [BLACK]: 0 },
        piecesOnBoard: { [WHITE]: 0, [BLACK]: 0 },
        selectedPiece: -1,
        mustRemove: 0,
        gameOver: false,
        winner: null,
        difficulty: difficulty || 'medium',
        aiThinking: false,
        lastMove: null,
        millPositions: [],
        popupShown: false
    };
}

// ---- Core Logic ----
function getPlayerPhase(state, player) {
    if (state.piecesPlaced[player] < TOTAL_PIECES) return 'placing';
    if (state.piecesOnBoard[player] === 3) return 'flying';
    return 'moving';
}

function isInMill(board, pos, player) {
    for (const mIdx of POSITION_MILLS[pos]) {
        if (MILLS[mIdx].every(p => board[p] === player)) return true;
    }
    return false;
}

function findMillPositions(board, pos, player) {
    const result = [];
    for (const mIdx of POSITION_MILLS[pos]) {
        if (MILLS[mIdx].every(p => board[p] === player)) result.push(...MILLS[mIdx]);
    }
    return [...new Set(result)];
}

function countMillsCompleted(board, pos, player) {
    let count = 0;
    for (const mIdx of POSITION_MILLS[pos]) {
        if (MILLS[mIdx].every(p => board[p] === player)) count++;
    }
    return count;
}

function getRemovable(board, opponent) {
    const list = [];
    for (let i = 0; i < 24; i++) {
        if (board[i] === opponent) list.push(i);
    }
    return list;
}

function getLegalMoves(state, player) {
    const phase = getPlayerPhase(state, player);
    const moves = [];
    if (phase === 'placing') {
        for (let i = 0; i < 24; i++) {
            if (state.board[i] === EMPTY) moves.push({ type: 'place', to: i });
        }
    } else {
        const canFly = phase === 'flying';
        for (let from = 0; from < 24; from++) {
            if (state.board[from] !== player) continue;
            const targets = canFly
                ? Array.from({ length: 24 }, (_, i) => i).filter(i => state.board[i] === EMPTY)
                : ADJACENCY[from].filter(i => state.board[i] === EMPTY);
            for (const to of targets) moves.push({ type: 'move', from, to });
        }
    }
    return moves;
}

function cloneState(state) {
    return {
        board: [...state.board],
        currentPlayer: state.currentPlayer,
        piecesPlaced: { ...state.piecesPlaced },
        piecesOnBoard: { ...state.piecesOnBoard }
    };
}

function applyMove(state, move) {
    const s = cloneState(state);
    const player = s.currentPlayer;
    const opp = player === WHITE ? BLACK : WHITE;
    if (move.type === 'place') {
        s.board[move.to] = player;
        s.piecesPlaced[player]++;
        s.piecesOnBoard[player]++;
    } else {
        s.board[move.from] = EMPTY;
        s.board[move.to] = player;
    }
    if (move.remove != null) {
        if (Array.isArray(move.remove)) {
            for (const r of move.remove) {
                s.board[r] = EMPTY;
                s.piecesOnBoard[opp]--;
            }
        } else {
            s.board[move.remove] = EMPTY;
            s.piecesOnBoard[opp]--;
        }
    }
    s.currentPlayer = opp;
    return s;
}

function checkGameOver(state) {
    for (const player of [WHITE, BLACK]) {
        if (getPlayerPhase(state, player) === 'placing') continue;
        if (state.piecesOnBoard[player] < 3) return player === WHITE ? BLACK : WHITE;
        if (getLegalMoves(state, player).length === 0) return player === WHITE ? BLACK : WHITE;
    }
    return null;
}

// ---- AI: Minimax with Alpha-Beta ----
function generateAIMoves(state) {
    const player = state.currentPlayer;
    const opp = player === WHITE ? BLACK : WHITE;
    const baseMoves = getLegalMoves(state, player);
    const fullMoves = [];
    for (const base of baseMoves) {
        const tempBoard = [...state.board];
        if (base.type === 'place') {
            tempBoard[base.to] = player;
        } else {
            tempBoard[base.from] = EMPTY;
            tempBoard[base.to] = player;
        }
        const millsCount = countMillsCompleted(tempBoard, base.to, player);
        if (millsCount > 0) {
            const removable = getRemovable(tempBoard, opp);
            if (removable.length > 0) {
                if (millsCount === 1 || removable.length === 1) {
                    for (const r of removable) fullMoves.push({ ...base, remove: [r] });
                } else {
                    for (let i = 0; i < removable.length; i++) {
                        for (let j = i + 1; j < removable.length; j++) {
                            fullMoves.push({ ...base, remove: [removable[i], removable[j]] });
                        }
                    }
                }
            } else {
                fullMoves.push({ ...base, remove: null });
            }
        } else {
            fullMoves.push({ ...base, remove: null });
        }
    }
    return fullMoves;
}

function evaluate(state) {
    const ai = BLACK, human = WHITE;
    const aiPhase = getPlayerPhase(state, ai);
    const humanPhase = getPlayerPhase(state, human);

    if (aiPhase !== 'placing' && state.piecesOnBoard[ai] < 3) return -100000;
    if (humanPhase !== 'placing' && state.piecesOnBoard[human] < 3) return 100000;
    if (aiPhase !== 'placing' && getLegalMoves(state, ai).length === 0) return -100000;
    if (humanPhase !== 'placing' && getLegalMoves(state, human).length === 0) return 100000;

    let score = 0;
    score += 100 * (state.piecesOnBoard[ai] - state.piecesOnBoard[human]);

    for (const mill of MILLS) {
        const vals = mill.map(p => state.board[p]);
        const aiC = vals.filter(v => v === ai).length;
        const huC = vals.filter(v => v === human).length;
        const emC = vals.filter(v => v === EMPTY).length;
        if (aiC === 3) score += 50;
        else if (huC === 3) score -= 50;
        if (aiC === 2 && emC === 1) score += 25;
        if (huC === 2 && emC === 1) score -= 25;
        if (aiC === 1 && emC === 2) score += 5;
        if (huC === 1 && emC === 2) score -= 5;
    }

    if (aiPhase !== 'placing') score += 5 * getLegalMoves(state, ai).length;
    if (humanPhase !== 'placing') score -= 5 * getLegalMoves(state, human).length;

    for (let i = 0; i < 24; i++) {
        if (state.board[i] === ai) score += ADJACENCY[i].length;
        else if (state.board[i] === human) score -= ADJACENCY[i].length;
    }

    // Bonus for being in flying phase (opponent weak)
    if (humanPhase === 'flying') score += 40;
    if (aiPhase === 'flying') score -= 40;

    return score;
}

function minimax(state, depth, alpha, beta, maximizing) {
    const winner = checkGameOver(state);
    if (winner === BLACK) return 100000 + depth;
    if (winner === WHITE) return -100000 - depth;
    if (depth === 0) return evaluate(state);

    const moves = generateAIMoves(state);
    if (moves.length === 0) return evaluate(state);

    // Move ordering: captures first
    moves.sort((a, b) => (b.remove != null ? 1 : 0) - (a.remove != null ? 1 : 0));

    if (maximizing) {
        let best = -Infinity;
        for (const move of moves) {
            const val = minimax(applyMove(state, move), depth - 1, alpha, beta, false);
            best = Math.max(best, val);
            alpha = Math.max(alpha, best);
            if (beta <= alpha) break;
        }
        return best;
    } else {
        let best = Infinity;
        for (const move of moves) {
            const val = minimax(applyMove(state, move), depth - 1, alpha, beta, true);
            best = Math.min(best, val);
            beta = Math.min(beta, best);
            if (beta <= alpha) break;
        }
        return best;
    }
}

function getBestAIMove() {
    const depth = AI_DEPTH[game.difficulty] || 3;
    const aiState = cloneState(game);
    aiState.currentPlayer = BLACK;
    const moves = generateAIMoves(aiState);
    if (moves.length === 0) return null;

    // Easy: add randomness
    if (game.difficulty === 'easy' && Math.random() < 0.3) {
        return moves[Math.floor(Math.random() * moves.length)];
    }

    let bestScore = -Infinity, bestMove = moves[0];
    for (const move of moves) {
        const newState = applyMove(aiState, move);
        const score = minimax(newState, depth - 1, -Infinity, Infinity, false);
        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }
    return bestMove;
}

// ---- UI ----
function initBoard() {
    const svg = document.getElementById('game-board');
    if (!svg) return;
    svg.innerHTML = '';

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'board-lines');

    // Single path for all lines for maximum robustness
    const d = [
        // Outer square
        "M 30 30 L 390 30 L 390 390 L 30 390 Z",
        // Middle square
        "M 90 90 L 330 90 L 330 330 L 90 330 Z",
        // Inner square
        "M 150 150 L 270 150 L 270 270 L 150 270 Z",
        // Connectors
        "M 210 30 L 210 150",
        "M 390 210 L 270 210",
        "M 210 390 L 210 270",
        "M 30 210 L 150 210"
    ].join(" ");
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('shape-rendering', 'crispEdges');
    group.appendChild(path);
    svg.appendChild(group);

    // Position nodes
    for (let i = 0; i < 24; i++) {
        const [x, y] = POS_COORDS[i];
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', 16);
        circle.setAttribute('class', 'board-pos');
        circle.setAttribute('data-pos', i);
        circle.addEventListener('click', () => handleClick(i));
        svg.appendChild(circle);
    }
}

function renderBoard() {
    if (!game) return;
    document.querySelectorAll('.board-pos').forEach(el => {
        const pos = parseInt(el.getAttribute('data-pos'));
        const piece = game.board[pos];
        el.classList.remove('white-piece', 'black-piece', 'empty-pos', 'selected', 'valid-target', 'removable', 'mill-flash');

        if (piece === WHITE) el.classList.add('white-piece');
        else if (piece === BLACK) el.classList.add('black-piece');
        else el.classList.add('empty-pos');
    });

    // Highlight selected
    if (game.selectedPiece >= 0) {
        const sel = document.querySelector(`[data-pos="${game.selectedPiece}"]`);
        if (sel) sel.classList.add('selected');
        // Show valid targets
        const phase = getPlayerPhase(game, WHITE);
        const canFly = phase === 'flying';
        const targets = canFly
            ? Array.from({ length: 24 }, (_, i) => i).filter(i => game.board[i] === EMPTY)
            : ADJACENCY[game.selectedPiece].filter(i => game.board[i] === EMPTY);
        targets.forEach(t => {
            const el = document.querySelector(`[data-pos="${t}"]`);
            if (el) el.classList.add('valid-target');
        });
    }

    // Highlight removable positions
    if (game.mustRemove) {
        const removable = getRemovable(game.board, BLACK);
        removable.forEach(r => {
            const el = document.querySelector(`[data-pos="${r}"]`);
            if (el) el.classList.add('removable');
        });
    }

    // Flash mill
    game.millPositions.forEach(p => {
        const el = document.querySelector(`[data-pos="${p}"]`);
        if (el) el.classList.add('mill-flash');
    });

    // Counters
    const phaseW = getPlayerPhase(game, WHITE);
    const phaseB = getPlayerPhase(game, BLACK);
    const wrContainer = document.querySelector('#white-info .piece-count');
    const brContainer = document.querySelector('#black-info .piece-count');
    
    if (wrContainer) {
        const isEn = document.documentElement.lang === 'en';
        wrContainer.innerHTML = phaseW === 'placing' 
            ? `${isEn ? 'Remaining:' : 'Pozostało:'} <strong id="white-remaining">${TOTAL_PIECES - game.piecesPlaced[WHITE]}</strong>` 
            : `${isEn ? 'Pieces:' : 'Pionków:'} <strong id="white-remaining">${game.piecesOnBoard[WHITE]}</strong>`;
    }
    
    if (brContainer) {
        const isEn = document.documentElement.lang === 'en';
        brContainer.innerHTML = phaseB === 'placing' 
            ? `${isEn ? 'Remaining:' : 'Pozostało:'} <strong id="black-remaining">${TOTAL_PIECES - game.piecesPlaced[BLACK]}</strong>` 
            : `${isEn ? 'Pieces:' : 'Pionków:'} <strong id="black-remaining">${game.piecesOnBoard[BLACK]}</strong>`;
    }
}

function setStatus(msg) {
    const el = document.getElementById('game-status');
    if (el) el.textContent = msg;
}

function getPhaseLabel(player) {
    const isEn = document.documentElement.lang === 'en';
    const phase = getPlayerPhase(game, player);
    if (phase === 'placing') return isEn ? 'Place a piece' : 'Postaw pionek';
    if (phase === 'flying') return isEn ? 'Flying phase — move to any empty spot' : 'Faza skakania — rusz się na dowolne pole';
    return isEn ? 'Move a piece' : 'Przesuń pionek';
}

function updateStatusForTurn() {
    const isEn = document.documentElement.lang === 'en';
    if (game.gameOver) {
        const msg = game.winner === WHITE 
            ? (isEn ? '🎉 You won!' : '🎉 Wygrałeś!') 
            : game.winner === BLACK 
                ? (isEn ? '💀 AI won!' : '💀 AI wygrało!') 
                : (isEn ? '🤝 Draw!' : '🤝 Remis!');
        setStatus(msg);
        
        if (!game.popupShown) {
            game.popupShown = true;
            document.getElementById('gameover-message').textContent = msg;
            openWindow('gameover');
        }
        return;
    }
    if (game.mustRemove > 0) {
        setStatus(isEn 
            ? `Mill! Click an opponent's piece to remove it (left: ${game.mustRemove}).` 
            : `Młynek! Kliknij pionek przeciwnika, aby go usunąć (zostało: ${game.mustRemove}).`);
        return;
    }
    if (game.currentPlayer === WHITE) {
        const phase = getPlayerPhase(game, WHITE);
        if (phase === 'placing') {
            const left = TOTAL_PIECES - game.piecesPlaced[WHITE];
            setStatus(isEn ? `Your turn — Place a piece (${left} left)` : `Twoja kolej — Postaw pionek (zostało ${left})`);
        } else if (game.selectedPiece >= 0) {
            setStatus(isEn ? 'Click on an adjacent empty spot to move' : 'Kliknij na sąsiednie wolne pole, aby się przesunąć');
        } else {
            setStatus(isEn ? `Your turn — ${getPhaseLabel(WHITE)}` : `Twoja kolej — ${getPhaseLabel(WHITE)}`);
        }
    } else {
        setStatus(isEn ? 'AI is thinking...' : 'AI myśli...');
    }
}

// ---- Player Interaction ----
function handleClick(pos) {
    if (!game || game.gameOver || game.aiThinking || game.currentPlayer !== WHITE) return;

    // Removal mode
    if (game.mustRemove > 0) {
        if (game.board[pos] !== BLACK) return;
        const removable = getRemovable(game.board, BLACK);
        if (!removable.includes(pos)) return;
        game.board[pos] = EMPTY;
        game.piecesOnBoard[BLACK]--;
        game.mustRemove--;
        if (game.mustRemove > 0 && getRemovable(game.board, BLACK).length > 0) {
            renderBoard();
            updateStatusForTurn();
            return;
        }
        game.mustRemove = 0;
        game.millPositions = [];
        game.currentPlayer = BLACK;
        endTurn();
        return;
    }

    const phase = getPlayerPhase(game, WHITE);

    if (phase === 'placing') {
        if (game.board[pos] !== EMPTY) return;
        game.board[pos] = WHITE;
        game.piecesPlaced[WHITE]++;
        game.piecesOnBoard[WHITE]++;
        if (isInMill(game.board, pos, WHITE)) {
            game.millPositions = findMillPositions(game.board, pos, WHITE);
            game.mustRemove = countMillsCompleted(game.board, pos, WHITE);
            renderBoard();
            updateStatusForTurn();
            return;
        }
        game.currentPlayer = BLACK;
        endTurn();

    } else {
        // Moving/flying phase
        if (game.selectedPiece < 0) {
            // Select own piece
            if (game.board[pos] !== WHITE) return;
            const canFly = phase === 'flying';
            const targets = canFly
                ? Array.from({ length: 24 }, (_, i) => i).filter(i => game.board[i] === EMPTY)
                : ADJACENCY[pos].filter(i => game.board[i] === EMPTY);
            if (targets.length === 0) return;
            game.selectedPiece = pos;
            renderBoard();
            updateStatusForTurn();
        } else {
            // Move to target
            if (pos === game.selectedPiece) {
                game.selectedPiece = -1;
                renderBoard();
                updateStatusForTurn();
                return;
            }
            // If clicking another own piece, reselect
            if (game.board[pos] === WHITE) {
                game.selectedPiece = pos;
                renderBoard();
                updateStatusForTurn();
                return;
            }
            if (game.board[pos] !== EMPTY) return;
            const canFly = phase === 'flying';
            const valid = canFly || ADJACENCY[game.selectedPiece].includes(pos);
            if (!valid) return;

            game.board[game.selectedPiece] = EMPTY;
            game.board[pos] = WHITE;
            const from = game.selectedPiece;
            game.selectedPiece = -1;

            if (isInMill(game.board, pos, WHITE)) {
                game.millPositions = findMillPositions(game.board, pos, WHITE);
                game.mustRemove = countMillsCompleted(game.board, pos, WHITE);
                renderBoard();
                updateStatusForTurn();
                return;
            }
            game.currentPlayer = BLACK;
            endTurn();
        }
    }
}

function endTurn() {
    game.selectedPiece = -1;
    // Check game over
    const winner = checkGameOver(game);
    if (winner) {
        game.gameOver = true;
        game.winner = winner;
        renderBoard();
        updateStatusForTurn();
        return;
    }
    renderBoard();
    updateStatusForTurn();

    if (game.currentPlayer === BLACK) {
        game.aiThinking = true;
        setTimeout(doAITurn, 450);
    }
}

function doAITurn() {
    if (!game || game.gameOver) return;
    const move = getBestAIMove();
    if (!move) {
        game.gameOver = true;
        game.winner = WHITE;
        game.aiThinking = false;
        renderBoard();
        updateStatusForTurn();
        return;
    }

    // Apply AI move
    if (move.type === 'place') {
        game.board[move.to] = BLACK;
        game.piecesPlaced[BLACK]++;
        game.piecesOnBoard[BLACK]++;
    } else {
        game.board[move.from] = EMPTY;
        game.board[move.to] = BLACK;
    }

    const formedMill = isInMill(game.board, move.to, BLACK);

    if (move.remove != null) {
        if (Array.isArray(move.remove)) {
            for (const r of move.remove) {
                game.board[r] = EMPTY;
                game.piecesOnBoard[WHITE]--;
            }
        } else {
            game.board[move.remove] = EMPTY;
            game.piecesOnBoard[WHITE]--;
        }
    }

    if (formedMill) {
        game.millPositions = findMillPositions(game.board, move.to, BLACK);
        renderBoard();
        // Brief flash then clear
        setTimeout(() => {
            game.millPositions = [];
            game.currentPlayer = WHITE;
            game.aiThinking = false;
            const w = checkGameOver(game);
            if (w) { game.gameOver = true; game.winner = w; }
            renderBoard();
            updateStatusForTurn();
        }, 600);
    } else {
        game.currentPlayer = WHITE;
        game.aiThinking = false;
        const w = checkGameOver(game);
        if (w) { game.gameOver = true; game.winner = w; }
        renderBoard();
        updateStatusForTurn();
    }
}

// ---- New Game ----
function newGame() {
    const sel = document.getElementById('difficulty-select');
    const diff = sel ? sel.value : 'medium';
    game = createGameState(diff);
    renderBoard();
    updateStatusForTurn();
    // Make sure game window is open
    openWindow('game');
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', function () {
    initBoard();
    // Auto-start a game when the game window opens
    setTimeout(() => {
        newGame();
    }, 600);
});
