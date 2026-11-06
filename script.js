/**
 * TÊNIS DE MESA 3D / VR - REGRAS ITTF & FÍSICA REALISTA
 */

// --- SINTETIZADOR DE SOM PROCEDURAL (Web Audio API) ---
const AudioEngine = {
    ctx: null,
    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
        }
    },
    playHit(freq = 400, type = 'sine', duration = 0.05) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },
    playTableBounce() { this.playHit(300, 'triangle', 0.08); },
    playPaddleHit() { this.playHit(600, 'sine', 0.04); },
    playNetHit() { this.playHit(150, 'sawtooth', 0.1); },
    playScore() {
        if (!this.ctx) return;
        [523.25, 659.25, 783.99].forEach((freq, idx) => {
            setTimeout(() => this.playHit(freq, 'sine', 0.15), idx * 100);
        });
    }
};

// --- DADOS E ESTADO DO JOGO ---
const GAME_STATE = {
    p1Points: 0,
    p2Points: 0,
    p1Sets: 0,
    p2Sets: 0,
    server: 1, // 1: Jogador, 2: CPU
    servesCount: 0,
    difficulty: 'medium', // 'easy', 'medium', 'hard'
    ballColor: '#ff7700',
    phase: 'SERVE', // 'SERVE', 'RALLY', 'POINT_OVER', 'MATCH_OVER'
    lastHitBy: 0, // 1 ou 2
    bouncesP1: 0,
    bouncesP2: 0,
    netTouched: false
};

// Dimensões Oficiais da Mesa ITTF (em metros)
const TABLE_WIDTH = 1.525;
const TABLE_LENGTH = 2.74;
const TABLE_HEIGHT = 0.76;
const NET_HEIGHT = 0.1525;
const BALL_RADIUS = 0.02; // 40mm diâmetro

// --- MOTOR GRÁFICO THREE.JS ---
let scene, camera, renderer;
let tableGroup, ball, p1Paddle, p2Paddle;
let ballVelocity = new THREE.Vector3();
let p1PaddleVelocity = new THREE.Vector3();
let lastP1Pos = new THREE.Vector3();
let mousePos = { x: 0, y: 0 };

function initEngine() {
    const container = document.getElementById('canvas-container');

    // Cena
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.FogExp2(0x0f172a, 0.15);

    // Câmara
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, TABLE_HEIGHT + 0.55, 1.95);

    // Renderizador
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    // Iluminação
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(2, 4, 1);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    // Construção de Objetos
    createEnvironment();
    createTable();
    createPaddles();
    createBall();

    // Eventos de Entrada (Rato & Janela)
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onCanvasClick);

    // Configurar Eventos da UI
    setupUIEvents();

    // Reset ao estado inicial de Saque
    resetBallToServe();

    // Loop Principal
    renderer.setAnimationLoop(gameLoop);
}

// --- CRIAÇÃO DOS ELEMENTOS 3D ---
function createEnvironment() {
    // Chão do Pavilhão
    const floorGeo = new THREE.PlaneGeometry(20, 20);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
}

function createTable() {
    tableGroup = new THREE.Group();

    // Tampo Azul Oficial ITTF
    const topGeo = new THREE.BoxGeometry(TABLE_WIDTH, 0.05, TABLE_LENGTH);
    const topMat = new THREE.MeshStandardMaterial({ color: 0x0c4a6e, roughness: 0.3 });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = TABLE_HEIGHT - 0.025;
    top.receiveShadow = true;
    top.castShadow = true;
    tableGroup.add(top);

    // Linhas Brancas da Mesa
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    // Linha Central (Divisória)
    const centerLine = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.051, TABLE_LENGTH), lineMat);
    centerLine.position.y = TABLE_HEIGHT - 0.025;
    tableGroup.add(centerLine);

    // Bordas Laterais
    const sideLine1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.051, TABLE_LENGTH), lineMat);
    sideLine1.position.set(-TABLE_WIDTH / 2 + 0.01, TABLE_HEIGHT - 0.025, 0);
    const sideLine2 = sideLine1.clone();
    sideLine2.position.x = TABLE_WIDTH / 2 - 0.01;
    tableGroup.add(sideLine1, sideLine2);

    // Pés da Mesa
    const legGeo = new THREE.BoxGeometry(0.05, TABLE_HEIGHT - 0.05, 0.05);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5 });
    const offsets = [
        [-TABLE_WIDTH / 2 + 0.1, (TABLE_HEIGHT - 0.05) / 2, -TABLE_LENGTH / 2 + 0.1],
        [TABLE_WIDTH / 2 - 0.1, (TABLE_HEIGHT - 0.05) / 2, -TABLE_LENGTH / 2 + 0.1],
        [-TABLE_WIDTH / 2 + 0.1, (TABLE_HEIGHT - 0.05) / 2, TABLE_LENGTH / 2 - 0.1],
        [TABLE_WIDTH / 2 - 0.1, (TABLE_HEIGHT - 0.05) / 2, TABLE_LENGTH / 2 - 0.1],
    ];
    offsets.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(...pos);
        leg.castShadow = true;
        tableGroup.add(leg);
    });

    // Rede
    const netGeo = new THREE.BoxGeometry(TABLE_WIDTH + 0.1, NET_HEIGHT, 0.01);
    const netMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, wireframe: true });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, TABLE_HEIGHT + NET_HEIGHT / 2, 0);
    net.castShadow = true;
    tableGroup.add(net);

    scene.add(tableGroup);
}

function createPaddles() {
    function makePaddle(redFront = true) {
        const group = new THREE.Group();
        // Lâmina de Madeira
        const bladeGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.01, 32);
        const woodMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5 });
        const blade = new THREE.Mesh(bladeGeo, woodMat);
        blade.rotation.x = Math.PI / 2;
        group.add(blade);

        // Borracha Frontal / Traseira (ITTF)
        const rubberGeo = new THREE.CylinderGeometry(0.079, 0.079, 0.002, 32);
        const redMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3 });
        const blackMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.3 });

        const front = new THREE.Mesh(rubberGeo, redFront ? redMat : blackMat);
        front.position.z = 0.006;
        front.rotation.x = Math.PI / 2;

        const back = new THREE.Mesh(rubberGeo, redFront ? blackMat : redMat);
        back.position.z = -0.006;
        back.rotation.x = Math.PI / 2;

        group.add(front, back);

        // Cabo da Raquete
        const handleGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.1, 16);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x92400e });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.y = -0.11;
        group.add(handle);

        return group;
    }

    p1Paddle = makePaddle(true);
    p2Paddle = makePaddle(false);

    scene.add(p1Paddle);
    scene.add(p2Paddle);
}

function createBall() {
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
    const ballMat = new THREE.MeshStandardMaterial({
        color: GAME_STATE.ballColor,
        roughness: 0.2
    });
    ball = new THREE.Mesh(ballGeo, ballMat);
    ball.castShadow = true;
    scene.add(ball);
}

// --- FÍSICA E LÓGICA DE JOGO ---
function resetBallToServe() {
    GAME_STATE.phase = 'SERVE';
    GAME_STATE.bouncesP1 = 0;
    GAME_STATE.bouncesP2 = 0;
    GAME_STATE.netTouched = false;
    ballVelocity.set(0, 0, 0);

    const isP1 = GAME_STATE.server === 1;
    const serveZ = isP1 ? TABLE_LENGTH / 2 - 0.2 : -TABLE_LENGTH / 2 + 0.2;
    ball.position.set(isP1 ? 0.2 : -0.2, TABLE_HEIGHT + 0.15, serveZ);

    document.getElementById('server-name').textContent = isP1 ? 'JOGADOR' : 'CPU (ITTF)';
}

function gameLoop() {
    updatePaddles();
    updatePhysics();
    updateAI();
    renderer.render(scene, camera);
}

function updatePaddles() {
    // P1 Segue o Cursor do Rato
    const targetX = mousePos.x * (TABLE_WIDTH / 1.2);
    const targetY = TABLE_HEIGHT + 0.1 + (mousePos.y + 0.5) * 0.5;
    const targetZ = TABLE_LENGTH / 2 + 0.15;

    // Calcular Velocidade de Impacto da Raquete
    p1PaddleVelocity.subVectors(new THREE.Vector3(targetX, targetY, targetZ), p1Paddle.position);
    p1Paddle.position.set(targetX, targetY, targetZ);
}

function updateAI() {
    if (GAME_STATE.phase !== 'RALLY' && GAME_STATE.server !== 2) return;

    // Saque da CPU
    if (GAME_STATE.phase === 'SERVE' && GAME_STATE.server === 2) {
        setTimeout(() => {
            if (GAME_STATE.phase === 'SERVE' && GAME_STATE.server === 2) {
                ballVelocity.set(
                    (Math.random() - 0.5) * 0.5,
                    2.2,
                    3.2 + (GAME_STATE.difficulty === 'hard' ? 1.0 : 0)
                );
                GAME_STATE.phase = 'RALLY';
                GAME_STATE.lastHitBy = 2;
                AudioEngine.playPaddleHit();
            }
        }, 1000);
        return;
    }

    // Movimentação da Raquete da CPU na Jogada
    const speedMap = { easy: 0.04, medium: 0.08, hard: 0.15 };
    const speed = speedMap[GAME_STATE.difficulty];

    const targetX = THREE.MathUtils.clamp(ball.position.x, -TABLE_WIDTH / 2, TABLE_WIDTH / 2);
    const targetY = THREE.MathUtils.clamp(ball.position.y, TABLE_HEIGHT + 0.05, TABLE_HEIGHT + 0.4);
    const targetZ = -TABLE_LENGTH / 2 - 0.1;

    p2Paddle.position.x += (targetX - p2Paddle.position.x) * speed;
    p2Paddle.position.y += (targetY - p2Paddle.position.y) * speed;
    p2Paddle.position.z = targetZ;

    // Rebatida da CPU
    if (ball.position.z < -TABLE_LENGTH / 2 + 0.2 && ballVelocity.z < 0 && GAME_STATE.phase === 'RALLY') {
        ballVelocity.z *= -1.05;
        ballVelocity.y = 2.5 + Math.random() * 0.5;
        ballVelocity.x = (Math.random() - 0.5) * 1.5;
        GAME_STATE.lastHitBy = 2;
        AudioEngine.playPaddleHit();
    }
}

function updatePhysics() {
    if (GAME_STATE.phase !== 'RALLY') return;

    const dt = 0.016; // FPS delta estimado
    const gravity = -9.81;

    // Aplicar Gravidade
    ballVelocity.y += gravity * dt;

    // Atualizar Posição
    ball.position.addScaledVector(ballVelocity, dt);

    // 1. Colisão com a Raquete do Jogador P1
    const distP1 = ball.position.distanceTo(p1Paddle.position);
    if (distP1 < 0.12 && ballVelocity.z > 0) {
        ballVelocity.z = -Math.abs(ballVelocity.z) * 1.05 - 1.5;
        ballVelocity.y = 2.2 + p1PaddleVelocity.y * 5;
        ballVelocity.x += p1PaddleVelocity.x * 4;
        GAME_STATE.lastHitBy = 1;
        AudioEngine.playPaddleHit();
    }

    // 2. Colisão com a Rede
    if (Math.abs(ball.position.z) < 0.02 && ball.position.y < TABLE_HEIGHT + NET_HEIGHT) {
        ballVelocity.z *= -0.3;
        ballVelocity.y *= 0.5;
        GAME_STATE.netTouched = true;
        AudioEngine.playNetHit();
    }

    // 3. Colisão com o Tampo da Mesa
    const inTableX = Math.abs(ball.position.x) <= TABLE_WIDTH / 2;
    const inTableZ = Math.abs(ball.position.z) <= TABLE_LENGTH / 2;
    const isTableSurface = Math.abs(ball.position.y - TABLE_HEIGHT) < BALL_RADIUS;

    if (inTableX && inTableZ && isTableSurface && ballVelocity.y < 0) {
        ballVelocity.y = -ballVelocity.y * 0.85; // Elasticidade da madeira
        AudioEngine.playTableBounce();

        if (ball.position.z > 0) {
            GAME_STATE.bouncesP1++;
        } else {
            GAME_STATE.bouncesP2++;
        }

        // Validação de Quique Duplo no mesmo campo
        if (GAME_STATE.bouncesP1 > 1) {
            awardPoint(2, "Quique Duplo!");
        } else if (GAME_STATE.bouncesP2 > 1) {
            awardPoint(1, "Quique Duplo!");
        }
    }

    // 4. Fora do Campo / Queda no Chão
    if (ball.position.y < 0.1 || Math.abs(ball.position.z) > TABLE_LENGTH / 2 + 1.0) {
        evaluatePointOutcome();
    }
}

// --- REGRAS OFICIAIS E PONTUAÇÃO (ITTF) ---
function evaluatePointOutcome() {
    // Saque com toque na rede -> LET (Repetir Saque)
    if (GAME_STATE.netTouched && GAME_STATE.bouncesP1 === 1 && GAME_STATE.bouncesP2 === 1) {
        showBanner("LET!", "Toque na rede - Repetir Saque");
        resetBallToServe();
        return;
    }

    if (GAME_STATE.lastHitBy === 1) {
        if (GAME_STATE.bouncesP2 === 1) {
            awardPoint(1, "Ponto para o Jogador!");
        } else {
            awardPoint(2, "Bola Fora do Jogador!");
        }
    } else if (GAME_STATE.lastHitBy === 2) {
        if (GAME_STATE.bouncesP1 === 1) {
            awardPoint(2, "Ponto para a CPU!");
        } else {
            awardPoint(1, "Bola Fora da CPU!");
        }
    }
}

function awardPoint(winner, reason) {
    GAME_STATE.phase = 'POINT_OVER';
    AudioEngine.playScore();

    if (winner === 1) GAME_STATE.p1Points++;
    else GAME_STATE.p2Points++;

    GAME_STATE.servesCount++;

    // Alternar Saque a cada 2 pontos (ou a cada 1 ponto no Deuce)
    const isDeuce = GAME_STATE.p1Points >= 10 && GAME_STATE.p2Points >= 10;
    const serveChangeInterval = isDeuce ? 1 : 2;

    if (GAME_STATE.servesCount >= serveChangeInterval) {
        GAME_STATE.server = GAME_STATE.server === 1 ? 2 : 1;
        GAME_STATE.servesCount = 0;
    }

    updateHUD();
    showBanner(`${reason}`, `Placar: ${GAME_STATE.p1Points} - ${GAME_STATE.p2Points}`);

    // Verificar Vitória do Set (11 Pontos, diferença de 2)
    const p1WinSet = GAME_STATE.p1Points >= 11 && (GAME_STATE.p1Points - GAME_STATE.p2Points) >= 2;
    const p2WinSet = GAME_STATE.p2Points >= 11 && (GAME_STATE.p2Points - GAME_STATE.p1Points) >= 2;

    if (p1WinSet || p2WinSet) {
        if (p1WinSet) GAME_STATE.p1Sets++;
        if (p2WinSet) GAME_STATE.p2Sets++;

        GAME_STATE.p1Points = 0;
        GAME_STATE.p2Points = 0;

        showBanner(p1WinSet ? "VENCEU O SET!" : "CPU VENCEU O SET!", "Próximo Set");
        updateHUD();
    }

    setTimeout(() => {
        resetBallToServe();
    }, 2000);
}

function updateHUD() {
    document.getElementById('p1-pts').textContent = String(GAME_STATE.p1Points).padStart(2, '0');
    document.getElementById('p2-pts').textContent = String(GAME_STATE.p2Points).padStart(2, '0');
    document.getElementById('p1-sets').textContent = `Sets: ${GAME_STATE.p1Sets}`;
    document.getElementById('p2-sets').textContent = `Sets: ${GAME_STATE.p2Sets}`;
    document.getElementById('server-name').textContent = GAME_STATE.server === 1 ? 'JOGADOR' : 'CPU (ITTF)';
}

function showBanner(title, subtitle) {
    const banner = document.getElementById('banner');
    document.getElementById('banner-title').textContent = title;
    document.getElementById('banner-subtitle').textContent = subtitle;
    banner.classList.remove('hidden');
    setTimeout(() => {
        banner.classList.add('hidden');
    }, 1800);
}

// --- EVENTOS DE INTERAÇÃO E INTERFACE ---
function onMouseMove(event) {
    mousePos.x = (event.clientX / window.innerWidth) * 2 - 1;
    mousePos.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onCanvasClick() {
    AudioEngine.init();

    // Executar Saque do Jogador P1
    if (GAME_STATE.phase === 'SERVE' && GAME_STATE.server === 1) {
        ballVelocity.set(
            (mousePos.x) * 1.5,
            2.2,
            -3.8
        );
        GAME_STATE.phase = 'RALLY';
        GAME_STATE.lastHitBy = 1;
        AudioEngine.playPaddleHit();
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function setupUIEvents() {
    // Seleção de Dificuldade
    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            GAME_STATE.difficulty = e.target.dataset.diff;
        });
    });

    // Seleção de Cor da Bola (40mm)
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            GAME_STATE.ballColor = e.target.dataset.color;
            if (ball) ball.material.color.set(GAME_STATE.ballColor);
        });
    });

    // Modal Informativo
    const modal = document.getElementById('info-modal');
    document.getElementById('info-btn').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('close-modal').addEventListener('click', () => modal.classList.add('hidden'));

    // Reiniciar Jogo
    document.getElementById('reset-btn').addEventListener('click', () => {
        GAME_STATE.p1Points = 0;
        GAME_STATE.p2Points = 0;
        GAME_STATE.p1Sets = 0;
        GAME_STATE.p2Sets = 0;
        GAME_STATE.server = 1;
        updateHUD();
        resetBallToServe();
    });

    // Botão VR (WebXR)
    document.getElementById('vr-btn').addEventListener('click', () => {
        if ('xr' in navigator) {
            navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
                if (supported) {
                    renderer.xr.enabled = true;
                    navigator.xr.requestSession('immersive-vr').then((session) => {
                        renderer.xr.setSession(session);
                    });
                } else {
                    alert("O dispositivo atual não suporta óculos de Realidade Virtual (WebXR).");
                }
            });
        } else {
            alert("Navegador sem suporte para WebXR.");
        }
    });
}

// Iniciar Aplicação ao Carregar
window.addEventListener('DOMContentLoaded', initEngine);
