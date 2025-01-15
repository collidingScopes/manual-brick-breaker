/*
To do:
Make the game colors / design more aesthetic
Mobile testing / functionality / formatting responsiveness
Write text / footer -- see if this breaks formatting -- maybe need to wrap the game container in a div
*/

// Optimization 1: Use RequestAnimationFrame with timestamp
let lastTime = 0;
const FPS = 60;
const frameDelay = 1000 / FPS;

// Optimization 2: Cache DOM elements and create offscreen canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const video = document.getElementById('videoElement');
const scoreElement = document.getElementById('scoreElement');
const hitsElement = document.getElementById('hitsElement');
const levelElement = document.getElementById('levelElement');
const levelUpIndicator = document.getElementById('levelUpIndicator');

// Optimization 3: Pre-calculate values and use constants
const CANVAS_WIDTH = canvas.width;
const CANVAS_HEIGHT = canvas.height;
const INITIAL_PADDLE_WIDTH = 150;
const PADDLE_HEIGHT = 15;
const BALL_RADIUS = 7;
const BRICK_ROW_COUNT = 3;
const BRICK_COLUMN_COUNT = 8;
const BRICK_WIDTH = 60;
const BRICK_HEIGHT = 20;
const BRICK_PADDING = 10;
const BRICK_OFFSET_TOP = 50;
const BRICK_OFFSET_LEFT = 70;
const TOTAL_BRICKS = BRICK_ROW_COUNT * BRICK_COLUMN_COUNT;

// Level progression constants
const INITIAL_BALL_SPEED = 7;
const LEVEL_SPEED_INCREASE = 1.1; // 10% increase
const LEVEL_WIDTH_DECREASE = 0.9; // 10% decrease

// Optimization 4: Use structured game state object
const gameState = {
    level: 1,
    paddle: {
        width: INITIAL_PADDLE_WIDTH,
        height: PADDLE_HEIGHT,
        x: CANVAS_WIDTH / 2 - INITIAL_PADDLE_WIDTH / 2,
        y: CANVAS_HEIGHT - 30
    },
    ball: {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT - 40,
        radius: BALL_RADIUS,
        dx: INITIAL_BALL_SPEED,
        dy: -INITIAL_BALL_SPEED,
        speed: INITIAL_BALL_SPEED,
        active: true
    },
    stats: {
        score: 0,
        hits: 0,
        bricksRemaining: TOTAL_BRICKS,
    },
    gameStarted: false,
    modalDismissed: false
};

// Optimization 5: Use typed arrays for better memory management
const bricks = new Float32Array(BRICK_ROW_COUNT * BRICK_COLUMN_COUNT * 3); // x, y, status

// Initialize bricks with TypedArray
function initBricks() {
    gameState.stats.bricksRemaining = TOTAL_BRICKS;
    for (let c = 0; c < BRICK_COLUMN_COUNT; c++) {
        for (let r = 0; r < BRICK_ROW_COUNT; r++) {
            const idx = (c * BRICK_ROW_COUNT + r) * 3;
            bricks[idx] = c * (BRICK_WIDTH + BRICK_PADDING) + BRICK_OFFSET_LEFT; // x
            bricks[idx + 1] = r * (BRICK_HEIGHT + BRICK_PADDING) + BRICK_OFFSET_TOP; // y
            bricks[idx + 2] = 1; // status
        }
    }
}

// Optimization 6: Efficient hand tracking setup
async function setupHandTracking() {
    const hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    
    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    // Optimization 7: Throttled hand tracking results
    let lastHandleTime = 0;
    const HAND_TRACKING_THROTTLE = 1000 / 30; // 30fps for hand tracking

    hands.onResults((results) => {
        const now = performance.now();
        if (now - lastHandleTime < HAND_TRACKING_THROTTLE) return;
        lastHandleTime = now;
        
        if (results.multiHandLandmarks?.[0]) {
            const palmX = 0.9 - (results.multiHandLandmarks[0][0].x * 1.11 - 0.1);
            gameState.paddle.x = Math.max(-50, 
                Math.min(CANVAS_WIDTH - gameState.paddle.width + 50,
                    (palmX * 1 * CANVAS_WIDTH) - (gameState.paddle.width / 2)
                )
            );

            if (!gameState.gameStarted && gameState.modalDismissed) {
                gameState.gameStarted = true;
            }
        }
    });

    const camera = new window.Camera(video, {
        onFrame: async () => {
            await hands.send({image: video});
        },
        width: 640,
        height: 480
    });
    
    camera.start();
}

// Level up function
function levelUp() {
    gameState.level++;
    levelElement.textContent = gameState.level;
    
    // Increase ball speed by 10%
    gameState.ball.speed *= LEVEL_SPEED_INCREASE;
    gameState.ball.dx = gameState.ball.speed * (gameState.ball.dx > 0 ? 1 : -1);
    gameState.ball.dy = gameState.ball.speed * (gameState.ball.dy > 0 ? 1 : -1);
    
    // Decrease paddle width by 10%
    gameState.paddle.width *= LEVEL_WIDTH_DECREASE;
    
    // Show level up indicator
    levelUpIndicator.style.opacity = '1';
    setTimeout(() => {
        levelUpIndicator.style.opacity = '0';
    }, 2000);
    
    // Reset ball position
    gameState.ball.active = true;
    gameState.ball.x = gameState.paddle.x + gameState.paddle.width/2;
    gameState.ball.y = gameState.paddle.y - BALL_RADIUS;
    
    // Initialize new level
    initBricks();
}

// Optimization 8: Efficient drawing functions using path batching
function drawBricks() {
    ctx.fillStyle = '#FF3333';
    ctx.beginPath();
    for (let i = 0; i < bricks.length; i += 3) {
        if (bricks[i + 2] === 1) {
            ctx.rect(bricks[i], bricks[i + 1], BRICK_WIDTH, BRICK_HEIGHT);
        }
    }
    ctx.fill();
}

function drawGame() {
    // Draw paddle
    ctx.fillStyle = '#3399CC';
    ctx.fillRect(gameState.paddle.x, gameState.paddle.y, gameState.paddle.width, PADDLE_HEIGHT);

    // Draw ball
    if (gameState.ball.active) {
        ctx.fillStyle = '#33FF99';
        ctx.beginPath();
        ctx.arc(gameState.ball.x, gameState.ball.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
    }
}

function checkWinCondition() {
    if (gameState.stats.bricksRemaining === 0) {
        levelUp();
        return true;
    }
    return false;
}

// Optimization 9: Efficient collision detection using grid-based approach
function collisionDetection() {
    if (!gameState.ball.active) return;

    const ballGridX = Math.floor((gameState.ball.x - BRICK_OFFSET_LEFT) / (BRICK_WIDTH + BRICK_PADDING));
    const ballGridY = Math.floor((gameState.ball.y - BRICK_OFFSET_TOP) / (BRICK_HEIGHT + BRICK_PADDING));

    // Check only nearby bricks
    for (let c = Math.max(0, ballGridX - 1); c <= Math.min(BRICK_COLUMN_COUNT - 1, ballGridX + 1); c++) {
        for (let r = Math.max(0, ballGridY - 1); r <= Math.min(BRICK_ROW_COUNT - 1, ballGridY + 1); r++) {
            const idx = (c * BRICK_ROW_COUNT + r) * 3;
            if (bricks[idx + 2] === 1) {
                if (gameState.ball.x > bricks[idx] && 
                    gameState.ball.x < bricks[idx] + BRICK_WIDTH && 
                    gameState.ball.y > bricks[idx + 1] && 
                    gameState.ball.y < bricks[idx + 1] + BRICK_HEIGHT) {
                    gameState.ball.dy = -gameState.ball.dy;
                    bricks[idx + 2] = 0;
                    gameState.stats.score += 1;
                    gameState.stats.bricksRemaining--;
                    scoreElement.textContent = gameState.stats.score;
                    checkWinCondition();
                }
            }
        }
    }
}

// Optimization 10: Main game loop with frame timing
function gameLoop(timestamp) {
    if (timestamp - lastTime >= frameDelay) {
        lastTime = timestamp;

        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = "#141D22";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        if (gameState.gameStarted && gameState.ball.active) {
            // Ball physics
            if (gameState.ball.x + gameState.ball.dx > CANVAS_WIDTH - BALL_RADIUS || 
                gameState.ball.x + gameState.ball.dx < BALL_RADIUS) {
                gameState.ball.dx = -gameState.ball.dx;
            }
            if (gameState.ball.y + gameState.ball.dy < BALL_RADIUS) {
                gameState.ball.dy = -gameState.ball.dy;
            }

            // Paddle collision
            if (gameState.ball.dy > 0 && 
                gameState.ball.y + gameState.ball.dy > gameState.paddle.y - BALL_RADIUS) {
                if (gameState.ball.x > gameState.paddle.x && 
                    gameState.ball.x < gameState.paddle.x + gameState.paddle.width) {
                    const hitPoint = (gameState.ball.x - gameState.paddle.x) / gameState.paddle.width;
                    const maxAngle = Math.PI / 3;
                    const angle = (hitPoint * 2 - 1) * maxAngle;
                    const speed = Math.sqrt(gameState.ball.dx * gameState.ball.dx + 
                                         gameState.ball.dy * gameState.ball.dy);
                    
                    gameState.ball.dx = Math.sin(angle) * speed;
                    gameState.ball.dy = -Math.cos(angle) * speed;

                    gameState.stats.hits++;
                    hitsElement.textContent = gameState.stats.hits;
                } else if (gameState.ball.y > CANVAS_HEIGHT + BALL_RADIUS) {
                    gameState.ball.active = false;
                    gameOver();
                }
            }

            gameState.ball.x += gameState.ball.dx;
            gameState.ball.y += gameState.ball.dy;
        } else {
            gameState.ball.x = gameState.paddle.x + gameState.paddle.width/2;
            gameState.ball.y = gameState.paddle.y - BALL_RADIUS;
        }

        drawBricks();
        drawGame();
        collisionDetection();
    }

    requestAnimationFrame(gameLoop);
}

function gameOver() {
    const gameOverModal = document.getElementById('gameOverModal');
    document.getElementById('finalLevel').textContent = gameState.level;
    document.getElementById('finalScore').textContent = gameState.stats.score;
    document.getElementById('finalHits').textContent = gameState.stats.hits;
    gameOverModal.style.display = 'flex';
    gameState.gameStarted = false;
}

function restartGame() {
    // Reset level
    gameState.level = 1;
    levelElement.textContent = '1';
    
    // Reset paddle width
    gameState.paddle.width = INITIAL_PADDLE_WIDTH;
    
    // Reset ball speed
    gameState.ball.speed = INITIAL_BALL_SPEED;
    gameState.ball.dx = INITIAL_BALL_SPEED;
    gameState.ball.dy = -INITIAL_BALL_SPEED;
    
    // Reset stats
    gameState.stats.score = 0;
    gameState.stats.hits = 0;
    scoreElement.textContent = '0';
    hitsElement.textContent = '0';
    
    gameState.ball.active = true;
    gameState.ball.x = gameState.paddle.x + gameState.paddle.width/2;
    gameState.ball.y = gameState.paddle.y - BALL_RADIUS;
    
    initBricks();
    
    document.getElementById('gameOverModal').style.display = 'none';
    document.getElementById('winModal').style.display = 'none';
    
    gameState.gameStarted = false;
    gameState.modalDismissed = true;
}

function startGame() {
    document.getElementById('startModal').style.display = 'none';
    gameState.modalDismissed = true;
    video.style.opacity = 0.6;
}

// Initialize game
initBricks();
setupHandTracking().catch(console.error);
requestAnimationFrame(gameLoop);