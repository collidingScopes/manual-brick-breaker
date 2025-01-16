/*
Mobile compatability, formatting, responsiveness
Improve scoreboard (show indicator to user that scores are being fetched / score is being posted, etc.)
Show that mediapipe hand tracker is currently loading
Add better tutorial (allow the user to test the movement before starting the game)
Create intro video (promo / instructions)
For high score table -- show message with percentile ranking and position (better than x% of players and tied for 9th position)
*/

let lastTime = 0;
const FPS = 60;
const frameDelay = 1000 / FPS;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const video = document.getElementById('videoElement');
const scoreElement = document.getElementById('scoreElement');
const hitsElement = document.getElementById('hitsElement');
const levelElement = document.getElementById('levelElement');
const livesElement = document.getElementById('livesElement');
const levelUpIndicator = document.getElementById('levelUpIndicator');

const CANVAS_WIDTH = canvas.width;
const CANVAS_HEIGHT = canvas.height;
const INITIAL_PADDLE_WIDTH = 150;
const PADDLE_HEIGHT = 15;
const BALL_RADIUS = 8;
const BRICK_ROW_COUNT = 3;
const BRICK_COLUMN_COUNT = 8;
const BRICK_WIDTH = 65;
const BRICK_HEIGHT = 20;
const BRICK_PADDING = 8;
const BRICK_OFFSET_TOP = 50;
const BRICK_OFFSET_LEFT = 58;
const INITIAL_LIVES = 3;

// Level progression constants
const INITIAL_BALL_SPEED = 7;
const LEVEL_SPEED_INCREASE = 1.1; // 10% increase
const LEVEL_WIDTH_DECREASE = 0.9; // 10% decrease

const gameState = {
    level: 1,
    lives: INITIAL_LIVES,
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
        bricksRemaining: 0
    },
    notification: {
        text: '',
        opacity: 0,
        fadeStart: 0
    },
    gameStarted: false,
    modalDismissed: false,
    gameOver: false,
};

const bricks = new Float32Array(BRICK_ROW_COUNT * BRICK_COLUMN_COUNT * 3); // x, y, status

function getBrickRowCount(level) {
    if (level === 1) return 1;
    if (level === 2) return 2;
    return 3; // Level 3 and higher
}

// Initialize bricks with TypedArray
function initBricks() {
    const rowCount = getBrickRowCount(gameState.level);
    gameState.stats.bricksRemaining = rowCount * BRICK_COLUMN_COUNT;
    
    // Clear existing bricks first
    bricks.fill(0);
    
    for (let c = 0; c < BRICK_COLUMN_COUNT; c++) {
        for (let r = 0; r < rowCount; r++) {
            const idx = (c * BRICK_ROW_COUNT + r) * 3;
            bricks[idx] = c * (BRICK_WIDTH + BRICK_PADDING) + BRICK_OFFSET_LEFT; // x
            bricks[idx + 1] = r * (BRICK_HEIGHT + BRICK_PADDING) + BRICK_OFFSET_TOP; // y
            bricks[idx + 2] = 1; // status
        }
    }
}

// Update lives display
function updateLivesDisplay() {
    livesElement.textContent = '💛'.repeat(gameState.lives);
}

function drawNotification() {
    if (gameState.notification.opacity <= 0) return;
    
    const currentTime = performance.now();
    const elapsed = currentTime - gameState.notification.fadeStart;
    const duration = 2000; // 2 seconds to fade out
    
    gameState.notification.opacity = Math.max(0, 1 - (elapsed / duration));
    
    if (gameState.notification.opacity > 0) {
        ctx.save();
        ctx.globalAlpha = gameState.notification.opacity;
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 24px "IBM Plex Mono"';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(gameState.notification.text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        ctx.restore();
    }
}

async function setupHandTracking() {
  let hands;
  let lastHandPosition = null;
  let noHandFrames = 0;
  const NO_HAND_THRESHOLD = 30;
  let positionBuffer = new Array(5).fill(null); // Buffer for position smoothing
  let lastProcessedTime = 0;
  const PROCESS_INTERVAL = 1000 / 30; // Limit to 30 FPS max
  
  async function initializeHandTracking() {
      try {
          hands = new window.Hands({
              locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
          });
          
          hands.setOptions({
              maxNumHands: 1,
              modelComplexity: 0, // Keep lowest complexity for speed
              minDetectionConfidence: 0.3, // Lower threshold for faster detection
              minTrackingConfidence: 0.3, // Lower threshold for smoother tracking
          });

          hands.onResults((results) => {
              const now = performance.now();
              
              // Throttle processing to maintain consistent frame rate
              if (now - lastProcessedTime < PROCESS_INTERVAL) return;
              lastProcessedTime = now;
              
              if (results.multiHandLandmarks?.[0]) {
                  noHandFrames = 0;
                  
                  // Calculate hand position with improved sensitivity
                  const rawX = results.multiHandLandmarks[0][0].x;
                  const palmX = 1.4 - (rawX * 1.8);
                  
                  // Update position buffer
                  positionBuffer.shift();
                  positionBuffer.push(palmX);
                  
                  // Calculate smoothed position using weighted average
                  const weights = [0.1, 0.15, 0.2, 0.25, 0.3]; // More weight to recent positions
                  let smoothedX = 0;
                  let totalWeight = 0;
                  
                  for (let i = 0; i < positionBuffer.length; i++) {
                      if (positionBuffer[i] !== null) {
                          smoothedX += positionBuffer[i] * weights[i];
                          totalWeight += weights[i];
                      }
                  }
                  
                  if (totalWeight > 0) {
                      smoothedX /= totalWeight;
                      lastHandPosition = smoothedX;
                      
                      // Apply exponential smoothing for extra fluidity
                      const alpha = 0.5; // Smoothing factor
                      const currentPaddleX = (gameState.paddle.x + gameState.paddle.width/2) / CANVAS_WIDTH;
                      smoothedX = (alpha * smoothedX) + ((1 - alpha) * currentPaddleX);
                      
                      // Update paddle position with improved bounds checking
                      const targetX = (smoothedX * CANVAS_WIDTH) - (gameState.paddle.width / 2);
                      gameState.paddle.x = Math.max(
                          -50, 
                          Math.min(CANVAS_WIDTH - gameState.paddle.width + 50, targetX)
                      );

                      // Reset video border to show tracking is working
                      video.style.border = "2px solid #3a4c4e";

                      if (!gameState.gameStarted && gameState.modalDismissed) {
                          gameState.gameStarted = true;
                      }
                  }
              } else {
                  noHandFrames++;
                  if (noHandFrames > NO_HAND_THRESHOLD) {
                      // Visual feedback that tracking is lost
                      video.style.border = "6px solid rgb(225, 21, 21)";
                  }
              }
          });

          return hands;
      } catch (error) {
          console.error('Error initializing hand tracking:', error);
          return null;
      }
  }

  // Initialize camera with error handling
  const camera = new window.Camera(video, {
      onFrame: async () => {
          try {
              if (!hands) {
                  hands = await initializeHandTracking();
              }
              if (hands) {
                  await hands.send({image: video});
              }
          } catch (error) {
              console.error('Error in camera frame:', error);
              hands = null; // Reset hands so it will reinitialize
              // Try to reinitialize after a short delay
              setTimeout(async () => {
                  hands = await initializeHandTracking();
              }, 1000);
          }
      },
      width: 640,
      height: 480
  });

  // Add error handling for camera start
  try {
      await camera.start();
  } catch (error) {
      console.error('Error starting camera:', error);
      // Try to restart camera after a delay
      setTimeout(async () => {
          try {
              await camera.start();
          } catch (error) {
              console.error('Failed to restart camera:', error);
          }
      }, 2000);
  }
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

// Handle ball miss
function handleBallMiss() {
  gameState.lives--;
  updateLivesDisplay();
  
  if (gameState.lives <= 0) {
      console.log("game over");
      gameState.ball.active = false;
      handleGameOver();
  } else {
      // Show notification
      gameState.notification.text = `${gameState.lives} ${gameState.lives === 1 ? 'life' : 'lives'} remaining`;
      gameState.notification.opacity = 1;
      gameState.notification.fadeStart = performance.now();
      
      // Reset ball position but keep playing
      gameState.ball.active = true;
      gameState.ball.x = gameState.paddle.x + gameState.paddle.width/2;
      gameState.ball.y = gameState.paddle.y - BALL_RADIUS;
      gameState.ball.dx = gameState.ball.speed * (Math.random() > 0.5 ? 1 : -1);
      gameState.ball.dy = -gameState.ball.speed;
  }
}

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

//Main game loop with frame timing
function gameLoop(timestamp) {
  if (timestamp - lastTime >= frameDelay) {
      lastTime = timestamp;

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = "#141D22";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      
      if (gameState.gameStarted && gameState.ball.active && !gameState.gameOver) {
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
                  handleBallMiss();
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
      drawNotification();
      collisionDetection();
  }

  requestAnimationFrame(gameLoop);
}

/*
function gameOver() {
  const gameOverModal = document.getElementById('gameOverModal');
  document.getElementById('finalLevel').textContent = gameState.level;
  document.getElementById('finalScore').textContent = gameState.stats.score;
  document.getElementById('finalHits').textContent = gameState.stats.hits;
  gameOverModal.style.display = 'flex';
  gameState.gameStarted = false;
  gameState.gameOver = false;
}
*/

const HIGHSCORE_URL = 'https://script.google.com/macros/s/AKfycbzlUWmuLiYLPzUoxA0cut6g69zAxA8VNu2J2l22snyamGoBeeOAfR7yfGmROkgwmSUDhA/exec';
// Fetch high scores from Google Sheets
async function getHighScores() {
    try {
        const response = await fetch(HIGHSCORE_URL);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        return data.scores;
    } catch (error) {
        console.error('Error fetching high scores:', error);
        return null;
    }
}

// Submit a new score to Google Sheets
async function submitScore(name, score, level) {
    try {
        const response = await fetch(HIGHSCORE_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                name: name.substring(0, 20), // Limit name length
                score: score,
                level: level
            })
        });
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return true;
    } catch (error) {
        console.error('Error submitting score:', error);
        return false;
    }
}

// Handle game over and high score submission
async function handleGameOver() {
    // First show regular game over screen
    const gameOverModal = document.getElementById('gameOverModal');
    document.getElementById('finalLevel').textContent = gameState.level;
    document.getElementById('finalScore').textContent = gameState.stats.score;
    document.getElementById('finalHits').textContent = gameState.stats.hits;

    // Show the game over modal
    let highScoreTable = document.querySelector(".high-scores");
    if(highScoreTable){
      highScoreTable.classList.add("hidden");
    }
    gameOverModal.style.display = 'flex';

    // Add slight delay so game over screen is visible first
    let playerName;
    setTimeout(() => {
      playerName = prompt("Enter your name for the leaderboard:", "Player");
    }, 500);

    // Fetch existing high scores
    const loadingText = document.querySelector('.loading-text');
    loadingText.classList.remove("hidden");
    const highScores = await getHighScores();

    // Check if current score is a high score
    let isHighScore = false;
    if (highScores && highScores.length > 0) {
        isHighScore = highScores.length < 10 || gameState.stats.score > highScores[highScores.length - 1][1];
    }

    if (playerName) {
        submitScore(playerName, gameState.stats.score, gameState.level)
            .then(success => {
                if (success) {
                    // Refresh high scores after submission
                    return getHighScores();
                }
            })
            .then(updatedScores => {
                if (updatedScores) {
                    displayHighScores(updatedScores);
                    document.querySelector(".high-scores").classList.remove("hidden");
                    loadingText.classList.add("hidden");
                }
            })
            .catch(error => {
                console.error('Error handling high score:', error);
            });
    }

    
    if (isHighScore) {

    }
    
    gameState.gameStarted = false;
    gameState.gameOver = true;
}

// Display high scores in the game over modal
function displayHighScores(scores) {
    if (!scores) return;
    
    // Create high scores HTML
    const highScoresHTML = `
        <div class="high-scores">
            <h3>Top 10 High Scores</h3>
            <div class="scores-list">
                ${scores.map((score, index) => `
                    <div class="score-entry ${gameState.stats.score === score[1] ? 'current-score' : ''}">
                        <span class="rank">${index + 1}</span>
                        <span class="name">${score[0]}</span>
                        <span class="score">${score[1]}</span>
                        <span class="level">Level ${score[2]}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    // Find or create high scores container in modal
    let highScoresContainer = document.querySelector('.high-scores');
    if (!highScoresContainer) {
        const modalContent = document.querySelector('#gameOverModal .modal-content');
        const restartButton = modalContent.querySelector('.restart-button');
        const container = document.createElement('div');
        container.innerHTML = highScoresHTML;
        modalContent.insertBefore(container, restartButton);
    } else {
        highScoresContainer.outerHTML = highScoresHTML;
    }
}

function closeGameOverModal() {
  const gameOverModal = document.getElementById('gameOverModal');
  gameOverModal.style.display = 'none';
}

function restartGame() {
  gameState.level = 1;
  levelElement.textContent = '1';
  
  gameState.lives = INITIAL_LIVES;
  updateLivesDisplay();
  
  gameState.paddle.width = INITIAL_PADDLE_WIDTH;
  
  gameState.ball.speed = INITIAL_BALL_SPEED;
  gameState.ball.dx = INITIAL_BALL_SPEED;
  gameState.ball.dy = -INITIAL_BALL_SPEED;
  
  gameState.stats.score = 0;
  gameState.stats.hits = 0;
  scoreElement.textContent = '0';
  hitsElement.textContent = '0';
  
  gameState.notification = {
      text: '',
      opacity: 0,
      fadeStart: 0
  };
  
  gameState.ball.active = true;
  gameState.ball.x = gameState.paddle.x + gameState.paddle.width/2;
  gameState.ball.y = gameState.paddle.y - BALL_RADIUS;

  gameState.gameOver = false;

  initBricks();
  
  document.getElementById('gameOverModal').style.display = 'none';
  document.getElementById('winModal').style.display = 'none';
  
  gameState.gameStarted = true;
  gameState.modalDismissed = true;

  // Give the ball an initial direction
  gameState.ball.dx = INITIAL_BALL_SPEED * (Math.random() > 0.5 ? 1 : -1);
  gameState.ball.dy = -INITIAL_BALL_SPEED;
}

function startGame() {
  document.getElementById('startModal').style.display = 'none';
  gameState.modalDismissed = true;
  video.style.opacity = 0.45;
}

//add smooth scroll behaviour to anchor tag link
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
      e.preventDefault();

      document.querySelector(this.getAttribute('href')).scrollIntoView({
          behavior: 'smooth'
      });
  });
});

// Initialize game
updateLivesDisplay();
initBricks();
setupHandTracking().catch(console.error);
requestAnimationFrame(gameLoop);