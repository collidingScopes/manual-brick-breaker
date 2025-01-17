/*
Mobile compatability, formatting (reduce left/right margin -- increase canvas size on screen), responsiveness
Show that mediapipe hand tracker is currently loading
Add better tutorial (allow the user to test the movement before starting the game)
Create intro video (promo / instructions)
For high score table -- show text with percentile ranking and position (better than x% of players and tied for 9th position)
Add button to show high score table (below game canvas)
Hand detection sometimes lost on Mac (need fallback or retry conncetion to mediapipe?)
Ability to "skip" to higher levels?
Load the top 10 high scores earlier (as async function) so that load lag is reduced?
- can weave in current user's score if needed post-game
*/

// Add these variables at the top level of your game.js file
let cachedHighScores = null;
let allScores = null;
let highScoresFetched = false;

let screenWidth = window.innerWidth;
console.log("screen width: "+screenWidth);
let widthThreshold = 700;
const CANVAS_WIDTH = screenWidth >= widthThreshold ? 700 : 350;
const CANVAS_HEIGHT = CANVAS_WIDTH;

const canvas = document.getElementById('gameCanvas');
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
const ctx = canvas.getContext('2d', { alpha: false });

const video = document.getElementById('videoElement');
const scoreElement = document.getElementById('scoreElement');
const levelElement = document.getElementById('levelElement');
const livesElement = document.getElementById('livesElement');
const levelUpIndicator = document.getElementById('levelUpIndicator');

let lastTime = 0;
const FPS = 60;
const frameDelay = 1000 / FPS;

const VIDEO_WIDTH = screenWidth >= widthThreshold ? 160 : 80;
const VIDEO_HEIGHT = screenWidth >= widthThreshold ? 120 : 60;
video.width = VIDEO_WIDTH;
video.height = VIDEO_HEIGHT;

const INITIAL_PADDLE_WIDTH = screenWidth >= widthThreshold ? 150 : 75;
const PADDLE_HEIGHT = screenWidth >= widthThreshold ? 15 : 8;
const BALL_RADIUS = screenWidth >= widthThreshold ? 8 : 6;
const BRICK_ROW_COUNT = 3;
const BRICK_COLUMN_COUNT = 8;
const BRICK_WIDTH = screenWidth >= widthThreshold ? 65 : 32;
const BRICK_HEIGHT = screenWidth >= widthThreshold ? 20 : 10;
const BRICK_PADDING = screenWidth >= widthThreshold ? 8 : 4;
const BRICK_OFFSET_TOP = screenWidth >= widthThreshold ? 50 : 25;
const BRICK_OFFSET_LEFT = screenWidth >= widthThreshold ? 58 : 29;
const INITIAL_LIVES = 3;
const PADDLE_BOTTOM_OFFSET = screenWidth >= widthThreshold ? 30 : 15;
const BALL_BOTTOM_OFFSET = screenWidth >= widthThreshold ? 40 : 20;

// Level progression constants
const INITIAL_BALL_SPEED = screenWidth >= widthThreshold ? 7 : 6;
const LEVEL_SPEED_INCREASE = 1.1; // 10% increase
const LEVEL_WIDTH_DECREASE = 0.9; // 10% decrease

const gameState = {
    level: 1,
    lives: INITIAL_LIVES,
    paddle: {
        width: INITIAL_PADDLE_WIDTH,
        height: PADDLE_HEIGHT,
        x: CANVAS_WIDTH / 2 - INITIAL_PADDLE_WIDTH / 2,
        y: CANVAS_HEIGHT - PADDLE_BOTTOM_OFFSET,
    },
    ball: {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT - BALL_BOTTOM_OFFSET,
        radius: BALL_RADIUS,
        dx: INITIAL_BALL_SPEED,
        dy: -INITIAL_BALL_SPEED,
        speed: INITIAL_BALL_SPEED,
        active: true
    },
    stats: {
        score: 0,
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
  // let lastHandPosition = null;
  let noHandFrames = 0;
  const NO_HAND_THRESHOLD = 60;
  let positionBuffer = new Array(5).fill(null);
  let lastProcessedTime = 0;
  const PROCESS_INTERVAL = 1000 / 30;
  let videoStream = null;
  let isProcessingFrame = false;
  // let retryCount = 0;
  // const MAX_RETRIES = 3;
  let handTrackingActive = false;
  let wasGameRunning = false;
  let pauseOverlay = null;

  const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

  // Configure video element
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  function createPauseOverlay() {
    pauseOverlay = document.createElement('div');
    pauseOverlay.className = 'pause-overlay';
    pauseOverlay.style.position = 'absolute';
    pauseOverlay.style.top = '50%';
    pauseOverlay.style.left = '50%';
    pauseOverlay.style.transform = 'translate(-50%, -50%)';
    pauseOverlay.style.background = 'rgba(0, 0, 0, 0.8)';
    pauseOverlay.style.color = 'white';
    pauseOverlay.style.padding = '20px';
    pauseOverlay.style.borderRadius = '10px';
    pauseOverlay.style.zIndex = '1000';
    pauseOverlay.style.textAlign = 'center';
    pauseOverlay.style.display = 'none';
    pauseOverlay.innerHTML = `
      <p style="color: #ff4444; margin-bottom: 10px;">Hand Tracking Lost</p>
      <p>Game paused. Please ensure your hand is visible to the camera.</p>
      <p>The game will resume automatically when hand tracking is restored.</p>
    `;
    document.querySelector('.game-container').appendChild(pauseOverlay);
    return pauseOverlay;
  }

  function pauseGame() {
    if (gameState.gameStarted && !gameState.gameOver) {
      wasGameRunning = true;
      gameState.gameStarted = false;
      if (!pauseOverlay) {
        pauseOverlay = createPauseOverlay();
      }
      pauseOverlay.style.display = 'block';
    }
  }

  function resumeGame() {
    if (wasGameRunning && !gameState.gameOver) {
      gameState.gameStarted = true;
      wasGameRunning = false;
      if (pauseOverlay) {
        pauseOverlay.style.display = 'none';
      }
    }
  }

  async function initializeHandTracking() {
    try {
      // Initialize MediaPipe Hands with fallback CDN
      const mediapipeCDNs = [
        'https://cdn.jsdelivr.net/npm/@mediapipe/hands/',
        'https://unpkg.com/@mediapipe/hands/',
        'https://www.gstatic.com/mediapipe/hands/'
      ];

      let loadError;
      for (const cdn of mediapipeCDNs) {
        try {
          hands = new window.Hands({
            locateFile: (file) => `${cdn}${file}`
          });
          loadError = null;
          break;
        } catch (error) {
          loadError = error;
          console.warn(`Failed to load from ${cdn}:`, error);
          continue;
        }
      }

      if (loadError) {
        throw loadError;
      }

      // Configure hand tracking options
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      // Set up results handler with error recovery
      hands.onResults((results) => {
        const now = performance.now();
        if (now - lastProcessedTime < PROCESS_INTERVAL) return;
        lastProcessedTime = now;
        
        if (results.multiHandLandmarks?.[0]) {
          noHandFrames = 0;
          const rawX = results.multiHandLandmarks[0][0].x;
          const palmX = 1.4 - (rawX * 1.8);
          
          positionBuffer.shift();
          positionBuffer.push(palmX);
          
          const weights = [0.1, 0.15, 0.2, 0.25, 0.3];
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
            // lastHandPosition = smoothedX;
            
            const alpha = 0.5;
            const currentPaddleX = (gameState.paddle.x + gameState.paddle.width/2) / CANVAS_WIDTH;
            smoothedX = (alpha * smoothedX) + ((1 - alpha) * currentPaddleX);
            
            const targetX = (smoothedX * CANVAS_WIDTH) - (gameState.paddle.width / 2);
            gameState.paddle.x = Math.max(
              -50, 
              Math.min(CANVAS_WIDTH - gameState.paddle.width + 50, targetX)
            );

            video.style.border = "2px solid #3a4c4e";
            handTrackingActive = true;

            if (!gameState.gameStarted && gameState.modalDismissed && !wasGameRunning) {
              gameState.gameStarted = true;
            } else if (handTrackingActive && wasGameRunning) {
              resumeGame();
            }
          }
        } else {
          noHandFrames++;
          if (noHandFrames > NO_HAND_THRESHOLD) {
            video.style.border = "6px solid rgb(225, 21, 21)";
            if (handTrackingActive) {
              handTrackingActive = false;
              pauseGame();
            }
          }
        }
      });

      return hands;
    } catch (error) {
      console.error('Error initializing hand tracking:', error);
      return null;
    }
  }

  // Enhanced camera initialization
  async function startCamera() {
    try {
      const permission = await navigator.permissions.query({ name: 'camera' });
      if (permission.state === 'denied') {
        throw new Error('Camera permission denied');
      }

      const constraints = {
        video: {
          width: { min: 320, ideal: 640, max: 1280 },
          height: { min: 240, ideal: 480, max: 720 },
          frameRate: { min: 15, ideal: 30, max: 60 },
          facingMode: "user"
        }
      };

      videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = videoStream;
      
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
      });

      await video.play();
      hands = await initializeHandTracking();
      
      // Start processing frames
      requestAnimationFrame(processFrame);
      return true;
    } catch (error) {
      console.error('Error starting camera:', error);
      throw error;
    }
  }

  async function processFrame() {
    if (!hands || !videoStream || isProcessingFrame) {
      requestAnimationFrame(processFrame);
      return;
    }

    isProcessingFrame = true;

    try {
      await hands.send({ image: video });
    } catch (error) {
      console.error('Error processing frame:', error);
    }

    isProcessingFrame = false;
    requestAnimationFrame(processFrame);
  }

  try {
    const success = await startCamera();
    if (!success) {
      throw new Error('Failed to initialize camera');
    }
  } catch (error) {
    console.error('Setup error:', error);
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
              gameState.ball.y + gameState.ball.dy > gameState.paddle.y - (BALL_RADIUS / 2) ) {
              if (gameState.ball.x > gameState.paddle.x && 
                  gameState.ball.x < gameState.paddle.x + gameState.paddle.width) {
                  const hitPoint = (gameState.ball.x - gameState.paddle.x) / gameState.paddle.width;
                  const maxAngle = Math.PI / 3;
                  const angle = (hitPoint * 2 - 1) * maxAngle;
                  const speed = Math.sqrt(gameState.ball.dx * gameState.ball.dx + 
                                       gameState.ball.dy * gameState.ball.dy);
                  
                  gameState.ball.dx = Math.sin(angle) * speed;
                  gameState.ball.dy = -Math.cos(angle) * speed;

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

const HIGHSCORE_URL = 'https://script.google.com/macros/s/AKfycbx4u8Gj-15Wl2r1D9O2dk6_AOvbPtW7TcmG7IItjfrJDVUQRk7IS4e9JiVBR5OqQ1c2mw/exec';

// Modified getHighScores function to use cached data
async function getHighScores() {
  if (!cachedHighScores) {
      // If we haven't cached the scores yet, try to fetch them
      await fetchHighScoresInBackground();
  }
  return cachedHighScores;
}

// Function to insert current score into cached high scores
function insertCurrentScore(currentScore, playerName, level) {
  if (!cachedHighScores) {
      cachedHighScores = [];
  }

  // Create new score entry
  const newScore = [playerName, currentScore, level];
  
  // Find the correct position to insert the new score
  let insertIndex = cachedHighScores.findIndex(score => currentScore > score[1]);
  if (insertIndex === -1) {
      insertIndex = cachedHighScores.length;
  }
  
  // Insert the new score
  cachedHighScores.splice(insertIndex, 0, newScore);
  
  // Keep only top 10 scores
  if (cachedHighScores.length > 10) {
      cachedHighScores = cachedHighScores.slice(0, 10);
  }
  
  return cachedHighScores;
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

// Modified handleGameOver function
async function handleGameOver() {
  // First show regular game over screen
  const gameOverModal = document.getElementById('gameOverModal');
  document.getElementById('finalLevel').textContent = "Level " + gameState.level;
  document.getElementById('finalScore').textContent = gameState.stats.score;
  
  // Show the game over modal
  let highScoreTable = document.querySelector(".high-scores");
  if (highScoreTable) {
      highScoreTable.classList.add("hidden");
  }
  gameOverModal.style.display = 'flex';
  
  // Add slight delay so game over screen is visible first
  let playerName;
  setTimeout(() => {
      playerName = prompt("Enter your name for the leaderboard:", "Player");
      if (playerName) {
          handleHighScores(playerName);
      }
  }, 500);
  
  gameState.gameStarted = false;
  gameState.gameOver = true;
}

// New function to handle high score logic
async function handleHighScores(playerName) {
  const loadingText = document.querySelector('.loading-text');
  loadingText.classList.remove("hidden");
  
  // If we haven't fetched high scores yet, do it now
  if (!cachedHighScores) {
      await fetchHighScoresInBackground();
  }
  
  // Insert current score into cached high scores
  const updatedScores = insertCurrentScore(
      gameState.stats.score,
      playerName,
      gameState.level
  );
  
  // Display high scores immediately using cached data
  displayHighScores(updatedScores);
  document.querySelector(".high-scores").classList.remove("hidden");
  loadingText.classList.add("hidden");
  
  // Submit score in the background
  submitScore(playerName, gameState.stats.score, gameState.level)
      .catch(error => {
          console.error('Error submitting score:', error);
      });
}

// Calculate the percentile rank of a score within all scores
function calculatePercentileRank(currentScore, scores) {
  if (!scores || scores.length === 0) return 0;

  // Convert current score to number and scores array to numbers
  currentScore = Number(currentScore);
  const scoreValues = scores.map(score => Number(score[1]));
  console.log(currentScore);
  console.log(scoreValues);

  // Count how many scores are lower than the current score
  const scoresBelow = scoreValues.filter(score => score < currentScore).length;
  
  // Calculate percentile (handling edge cases)
  if (scoresBelow === 0) return 0;
  if (scoresBelow === scoreValues.length) return 100;
  
  // Calculate percentile rank - ensure floating point division
  const percentile = (scoresBelow / scoreValues.length) * 100;
  
  return percentile;
}

// Create the percentile message element
function createPercentileMessage(percentile, currentScore) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'percentile-message';
  messageDiv.style.textAlign = 'center';
  messageDiv.style.marginTop = '15px';
  messageDiv.style.padding = '10px';
  messageDiv.style.backgroundColor = 'rgba(51, 255, 153, 0.1)';
  messageDiv.style.borderRadius = '5px';
  messageDiv.style.color = '#33FF99';
  messageDiv.style.fontWeight = 'bold';
  messageDiv.textContent = `Your score of ${currentScore} is better than ${parseFloat(percentile).toFixed(2)}% of all players`;
  return messageDiv;
}

function displayHighScores(topScores) {
  if (!topScores) return;
  
  // Calculate percentile for current score
  const percentile = calculatePercentileRank(gameState.stats.score, allScores);
  
  // Create high scores HTML
  const highScoresHTML = `
      <div class="high-scores">
          <h3>Top 10 High Scores</h3>
          <div class="scores-list">
              ${topScores.map((score, index) => `
                  <div class="score-entry ${gameState.stats.score === score[1] ? 'current-score' : ''}">
                      <span class="rank">${index + 1}</span>
                      <span class="name">${score[0]}</span>
                      <span class="level">Level ${score[2]}</span>
                      <span class="score">${score[1]}</span>
                  </div>
              `).join('')}
          </div>
      </div>
  `;
  
  // Find or create high scores container
  let highScoresContainer = document.querySelector('.high-scores');
  const modalContent = document.querySelector('#gameOverModal .modal-content');
  
  if (!highScoresContainer) {
      const container = document.createElement('div');
      container.innerHTML = highScoresHTML;
      const restartButton = modalContent.querySelector('.restart-button');
      modalContent.insertBefore(container, restartButton);
      highScoresContainer = container.querySelector('.high-scores');
  } else {
      highScoresContainer.outerHTML = highScoresHTML;
      highScoresContainer = document.querySelector('.high-scores');
  }
  
  // Remove existing percentile message if it exists
  const existingMessage = modalContent.querySelector('.percentile-message');
  if (existingMessage) {
      existingMessage.remove();
  }
  
  // Add percentile message
  const percentileMessage = createPercentileMessage(percentile, gameState.stats.score);
  if (highScoresContainer) {
      highScoresContainer.appendChild(percentileMessage);
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
  scoreElement.textContent = '0';
  
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

// Function to fetch high scores in the background
async function fetchHighScoresInBackground() {
  if (highScoresFetched) return;
  
  try {
      const response = await fetch(HIGHSCORE_URL);
      if (!response.ok) {
          throw new Error('Network response was not ok');
      }
      const data = await response.json();
      // Store all scores for percentile calculation
      allScores = data.scores;
      // Store only top 10 for display
      cachedHighScores = data.scores.slice(0, 10);
      highScoresFetched = true;
      console.log("high scores fetched");
  } catch (error) {
      console.error('Error fetching high scores:', error);
      // We'll try again later if this fails
      highScoresFetched = false;
  }
}

// Start fetching high scores as soon as the game loads
document.addEventListener('DOMContentLoaded', () => {
  fetchHighScoresInBackground();
});

// Initialize game
updateLivesDisplay();
initBricks();
setupHandTracking().catch(console.error);
requestAnimationFrame(gameLoop);