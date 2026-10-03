  import * as THREE from 'three';
  import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

  /* -------------------------------------------------------------------------- */
  /*                              ADJUSTABLE CONSTANTS                          */
  /* -------------------------------------------------------------------------- */

  // Board model transform.
  const BOARD_SCALE = 1.0;
  const BOARD_POSITION = { x: 0, y: 0, z: 0 };
  const BOARD_ROTATION = {
    x: 0,
    y: 0,
    z: 0
  };

  // Piece model transform. This is applied on top of the grid positions below.
  const PIECE_SCALE = 1.0;
  const PIECE_ROTATION = {
    x: 0,
    y: 0,
    z: 0
  };

  // Connect Four grid layout in the board's local coordinate system.
  const GRID_COLUMNS = 7;
  const GRID_ROWS = 6;
  const GRID_ORIGIN_X = -2.1;
  const GRID_ORIGIN_Y = 0.9;
  const GRID_ORIGIN_Z = 0.0;
  const GRID_COLUMN_SPACING = 0.6;
  const GRID_ROW_SPACING = 0.6;

  // Relative offsets between the board and pieces.
  const PIECE_OFFSET_X = 0;
  const PIECE_OFFSET_Y = 0;
  const PIECE_OFFSET_Z = 0;
  const HOVER_Y_OFFSET = 1.25;

  // Camera settings, intentionally similar to the original playground camera.
  const CAMERA_FRUSTUM_SIZE = 8;
  const CAMERA_MIN_DISTANCE = 7;
  const CAMERA_MAX_DISTANCE = 25;
  const CAMERA_MIN_ELEVATION = THREE.MathUtils.degToRad(0);
  const CAMERA_MAX_ELEVATION = THREE.MathUtils.degToRad(65);
  const CAMERA_INITIAL_AZIMUTH = Math.atan2(9, 10);
  const CAMERA_INITIAL_ELEVATION = Math.atan2(
    7,
    Math.sqrt(9 * 9 + 10 * 10)
  );
  const CAMERA_INITIAL_DISTANCE = Math.sqrt(10 * 10 + 7 * 7 + 9 * 9);
  const CAMERA_SMOOTHING = 0.12;

  // Interaction settings.
  const DRAG_THRESHOLD = 6;
  const ORBIT_SENSITIVITY = 0.01;
  const ZOOM_SENSITIVITY = 0.02;

  // Set true while tuning model transforms. Four pieces are placed at the
  // four grid corners and gameplay interaction is disabled.
  const DEBUG_FOUR_CORNERS = false;

  // Online multiplayer / Supabase.
  // When true, the server/database is authoritative for the board state.
  const ONLINE_PLAY = true;
  const ONLINE_POLL_INTERVAL_MS = 5000;
  const ONLINE_GAME_STATE_ID = 1;

  // This client is the "public" player represented by server turn value 1.
  // The legacy client treated turn value 0 as the other player's turn.
  const ONLINE_LOCAL_PLAYER = 'red';
  const ONLINE_LOCAL_TURN_VALUE = 1;
  const ONLINE_REMOTE_TURN_VALUE = 2;

  // The legacy database stores board rows as 6 arrays of 7 cells.
  // true  = server row 0 is the TOP row.
  // false = server row 0 is the BOTTOM row.
  const SERVER_ROW_ZERO_IS_TOP = true;

  // Astro exposes variables prefixed with PUBLIC_ to the browser bundle.
  const SUPABASE_URL =
    import.meta.env.PUBLIC_SUPABASE_URL?.replace(/\/$/, '');

  const SUPABASE_PUBLISHABLE_KEY =
    import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const GAME_STATE_REST_URL = SUPABASE_URL
    ? `${SUPABASE_URL}/rest/v1/game_state?id=eq.${ONLINE_GAME_STATE_ID}&select=*`
    : null;

  const EDGE_FUNCTION_URL = SUPABASE_URL
    ? `${SUPABASE_URL}/functions/v1/connect4`
    : null;

  // Win animation.
  const WIN_BLINK_PERIOD_MS = 320;
  const DROP_DURATION_MS = 500;

  const BOARD_MODEL_URL = '/models/connect-board.glb';
  const RED_MODEL_URL = '/models/connect-red.glb';
  const YELLOW_MODEL_URL = '/models/connect-yellow.glb';

  /* -------------------------------------------------------------------------- */
  /*                                  STATE                                     */
  /* -------------------------------------------------------------------------- */

  let container;
  let statusElement;
  let publicScoreElement;
  let ownerScoreElement;
  let scene;
  let camera;
  let renderer;
  let boardRoot;
  let boardModel;
  let interactionPlane;
  let previewPiece = null;

  let redModel = null;
  let yellowModel = null;
  let modelsReady = false;
  let initialized = false;

  let currentPlayer = 'red';
  let gameOver = false;
  let isDropping = false;

  // boardState[column][row] where row 0 is the lowest row.
  let boardState = Array.from(
    { length: GRID_COLUMNS },
    () => Array(GRID_ROWS).fill(null)
  );

  const placedPieces = [];
  const winningPieces = new Set();
  let winBlinkOn = true;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const localIntersection = new THREE.Vector3();

  let hoveredColumn = null;

  // Online state.
  let onlinePollInterval = null;
  let onlinePollInFlight = false;
  let onlineMovePending = false;
  let onlineReady = !ONLINE_PLAY;
  let onlineHasInitialState = false;
  let onlineServerTurn = null;
  let onlinePublicScore = 0;
  let onlineOwnerScore = 0;

  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let previousPointer = { x: 0, y: 0 };

  let lastPointerPosition = {
    x: 0,
    y: 0
  };

  let hasPointerPosition = false;

  const activePointers = new Map();
  let previousPinchDistance = null;

  const cameraTarget = new THREE.Vector3(
    BOARD_POSITION.x,
    BOARD_POSITION.y + GRID_ORIGIN_Y + (GRID_ROWS - 1) * GRID_ROW_SPACING * 0.5,
    BOARD_POSITION.z
  );

  let azimuth = CAMERA_INITIAL_AZIMUTH;
  let elevation = CAMERA_INITIAL_ELEVATION;
  let cameraDistance = CAMERA_INITIAL_DISTANCE;
  let targetAzimuth = azimuth;
  let targetElevation = elevation;
  let targetDistance = cameraDistance;

  /* -------------------------------------------------------------------------- */
  /*                                   INIT                                     */
  /* -------------------------------------------------------------------------- */

  // Debug camera: straight along the Z axis, looking at the board center.
  if (DEBUG_FOUR_CORNERS) {
    azimuth = targetAzimuth = 0;
    elevation = targetElevation = 0;
    cameraDistance = targetDistance = 14;
  }

  async function init() {
    container = document.getElementById('connect-four-container');
    statusElement = document.getElementById('connect-four-status');
    publicScoreElement = document.getElementById('connect-public-score');
    ownerScoreElement = document.getElementById('connect-owner-score');

    if (!container || !statusElement) return;

    if (!isWebGLAvailable()) {
      statusElement.textContent = '3D Graphics Unavailable';
      return;
    }

    try {
      scene = new THREE.Scene();

      const width = container.clientWidth;
      const height = container.clientHeight;
      const aspect = width / Math.max(height, 1);

      camera = new THREE.OrthographicCamera(
        (CAMERA_FRUSTUM_SIZE * aspect) / -2,
        (CAMERA_FRUSTUM_SIZE * aspect) / 2,
        CAMERA_FRUSTUM_SIZE / 2,
        CAMERA_FRUSTUM_SIZE / -2,
        0.1,
        1000
      );
      updateCamera();

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      container.appendChild(renderer.domElement);

      setupLighting();
      createBoardRoot();
      createInteractionPlane();
      setupPointerEvents();
      setupStatusInteraction();

      const resizeObserver = new ResizeObserver(() => onResize());
      resizeObserver.observe(container);

      initialized = true;
      setStatus(
        ONLINE_PLAY ? 'Connecting to game server...' : 'Loading Connect Four...',
        'neutral'
      );

      await loadModels();
      modelsReady = true;

      if (DEBUG_FOUR_CORNERS) {
        createDebugPieces();
        setStatus('Debug mode: four corner pieces', 'neutral');
      } else if (ONLINE_PLAY) {
        createPreviewPiece();
        updatePreview();

        // Load the authoritative state before accepting input.
        await fetchBoardState(true);
        startOnlinePolling();
      } else {
        createPreviewPiece();
        updatePreview();
        setStatus("Red's turn", 'red');
      }
    } catch (error) {
      console.error('Failed to initialize Connect Four:', error);
      statusElement.textContent = 'Failed to load Connect Four.';
    }
  }

  function setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(15, 30, 10);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -20;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);
  }

  function createBoardRoot() {
    boardRoot = new THREE.Group();
    boardRoot.position.set(
      BOARD_POSITION.x,
      BOARD_POSITION.y,
      BOARD_POSITION.z
    );
    boardRoot.rotation.set(
      BOARD_ROTATION.x,
      BOARD_ROTATION.y,
      BOARD_ROTATION.z
    );
    boardRoot.scale.setScalar(BOARD_SCALE);
    scene.add(boardRoot);
  }

  function createInteractionPlane() {
    const width = GRID_COLUMNS * GRID_COLUMN_SPACING;
    const height = GRID_ROWS * GRID_ROW_SPACING;

    const geometry = new THREE.PlaneGeometry(width, height);

    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    interactionPlane = new THREE.Mesh(
      geometry,
      material
    );

    interactionPlane.position.set(
      GRID_ORIGIN_X +
        ((GRID_COLUMNS - 1) * GRID_COLUMN_SPACING) / 2 +
        PIECE_OFFSET_X,

      GRID_ORIGIN_Y +
        ((GRID_ROWS - 1) * GRID_ROW_SPACING) / 2 +
        PIECE_OFFSET_Y,

      GRID_ORIGIN_Z +
        PIECE_OFFSET_Z
    );

    boardRoot.add(interactionPlane);
  }

  async function loadModels() {
    const loader = new GLTFLoader();

    const [boardGltf, redGltf, yellowGltf] = await Promise.all([
      loader.loadAsync(BOARD_MODEL_URL),
      loader.loadAsync(RED_MODEL_URL),
      loader.loadAsync(YELLOW_MODEL_URL)
    ]);

    boardModel = boardGltf.scene;
    boardModel.scale.setScalar(1);
    prepareModel(boardModel, true);
    boardRoot.add(boardModel);

    redModel = redGltf.scene;
    yellowModel = yellowGltf.scene;
    prepareModel(redModel, true);
    prepareModel(yellowModel, true);
  }

  function prepareModel(root, shadows = true) {
    root.traverse((object) => {
      if (!object.isMesh) return;

      object.castShadow = shadows;
      object.receiveShadow = shadows;

      // Avoid changing the shared source material's state unexpectedly.
      if (Array.isArray(object.material)) {
        object.material = object.material.map((material) =>
          material ? material.clone() : material
        );
      } else if (object.material) {
        object.material = object.material.clone();
      }
    });
  }

  /* -------------------------------------------------------------------------- */
  /*                              PIECE MANAGEMENT                              */
  /* -------------------------------------------------------------------------- */

  function clonePieceModel(player) {
    const source = player === 'red' ? redModel : yellowModel;
    const piece = source.clone(true);

    piece.scale.setScalar(PIECE_SCALE);
    piece.rotation.set(
      PIECE_ROTATION.x,
      PIECE_ROTATION.y,
      PIECE_ROTATION.z
    );

    piece.userData.player = player;
    return piece;
  }

  function getGridPosition(column, row) {
    return new THREE.Vector3(
      GRID_ORIGIN_X +
        column * GRID_COLUMN_SPACING +
        PIECE_OFFSET_X,
      GRID_ORIGIN_Y +
        row * GRID_ROW_SPACING +
        PIECE_OFFSET_Y,
      GRID_ORIGIN_Z + PIECE_OFFSET_Z
    );
  }

  function createPreviewPiece() {
    if (!modelsReady || DEBUG_FOUR_CORNERS) return;

    if (previewPiece) {
      boardRoot.remove(previewPiece);
    }

    previewPiece = clonePieceModel(currentPlayer);
    previewPiece.userData.preview = true;
    boardRoot.add(previewPiece);
    updatePreview();
  }

  function updatePreview() {
    if (
      !previewPiece ||
      gameOver ||
      isDropping ||
      DEBUG_FOUR_CORNERS ||
      (ONLINE_PLAY && !canLocalPlayerMove())
    ) {
      if (previewPiece) previewPiece.visible = false;
      return;
    }

    if (hoveredColumn === null || isColumnFull(hoveredColumn)) {
      previewPiece.visible = false;
      return;
    }

    const position = getGridPosition(hoveredColumn, GRID_ROWS - 1);
    position.y =
      GRID_ORIGIN_Y +
      (GRID_ROWS - 1) * GRID_ROW_SPACING +
      PIECE_OFFSET_Y +
      HOVER_Y_OFFSET;

    previewPiece.position.copy(position);
    previewPiece.visible = true;
  }

  function placePiece(column) {
    if (
      DEBUG_FOUR_CORNERS ||
      !modelsReady ||
      gameOver ||
      isDropping ||
      column === null ||
      isColumnFull(column)
    ) {
      return;
    }

    if (ONLINE_PLAY) {
      if (!canLocalPlayerMove()) return;

      submitOnlineMove(column);
      return;
    }

    const row = boardState[column].findIndex((value) => value === null);
    if (row < 0) return;

    const player = currentPlayer;
    boardState[column][row] = player;

    const piece = clonePieceModel(player);
    animatePieceIntoCell(piece, column, row, player, true);
  }

  function animatePieceIntoCell(
    piece,
    column,
    row,
    player,
    checkGameState,
    onComplete = null
  ) {
    const startPosition = getGridPosition(column, GRID_ROWS - 1);
    startPosition.y =
      GRID_ORIGIN_Y +
      (GRID_ROWS - 1) * GRID_ROW_SPACING +
      PIECE_OFFSET_Y +
      HOVER_Y_OFFSET;

    const endPosition = getGridPosition(column, row);

    piece.position.copy(startPosition);
    piece.visible = true;
    boardRoot.add(piece);

    placedPieces.push({
      piece,
      column,
      row,
      player
    });

    isDropping = true;

    if (previewPiece) previewPiece.visible = false;

    const dropStartTime = performance.now();

    const animateDrop = (time) => {
      const progress = THREE.MathUtils.clamp(
        (time - dropStartTime) / DROP_DURATION_MS,
        0,
        1
      );

      const eased = 1 - Math.pow(1 - progress, 3);
      piece.position.lerpVectors(startPosition, endPosition, eased);

      if (progress < 1) {
        requestAnimationFrame(animateDrop);
        return;
      }

      piece.position.copy(endPosition);
      isDropping = false;

      if (!checkGameState) {
        if (onComplete) onComplete();
        updatePreview();
        return;
      }

      const winningCells = findWinningCells(column, row, player);
      if (winningCells.length > 0) {
        finishGameWithWinner(winningCells, player);
        return;
      }

      if (isBoardFull()) {
        gameOver = true;
        setStatus('Draw — click here to reset', 'neutral');
        return;
      }

      currentPlayer = currentPlayer === 'red' ? 'yellow' : 'red';
      createPreviewPiece();
      setStatus(
        currentPlayer === 'red' ? "Red's turn" : "Yellow's turn",
        currentPlayer
      );
    };

    requestAnimationFrame(animateDrop);
  }

  function isColumnFull(column) {
    return boardState[column][GRID_ROWS - 1] !== null;
  }

  function isBoardFull() {
    return boardState.every((column) => column.every((cell) => cell !== null));
  }

  function clearBoard() {
    for (const entry of placedPieces) {
      boardRoot.remove(entry.piece);
    }

    placedPieces.length = 0;
    winningPieces.clear();
    boardState = Array.from(
      { length: GRID_COLUMNS },
      () => Array(GRID_ROWS).fill(null)
    );
    currentPlayer = 'red';
    gameOver = false;
    isDropping = false;
    winBlinkOn = true;
    hoveredColumn = null;

    createPreviewPiece();

    if (ONLINE_PLAY) {
      updateOnlineStatus();
    } else {
      setStatus("Red's turn", 'red');
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                              ONLINE SYNC                                   */
  /* -------------------------------------------------------------------------- */

  function canLocalPlayerMove() {
    return (
      !ONLINE_PLAY ||
      (
        onlineReady &&
        !onlineMovePending &&
        !gameOver &&
        onlineServerTurn === ONLINE_LOCAL_TURN_VALUE
      )
    );
  }

  function serverValueToPlayer(value) {
    if (value === 1 || value === '1') return 'red';
    if (value === 2 || value === '2') return 'yellow';
    return null;
  }

  function turnValueToPlayer(value) {
    if (value === ONLINE_LOCAL_TURN_VALUE) {
      return ONLINE_LOCAL_PLAYER;
    }

    if (value === ONLINE_REMOTE_TURN_VALUE) {
      return ONLINE_LOCAL_PLAYER === 'red' ? 'yellow' : 'red';
    }

    return null;
  }

  function convertServerBoard(serverBoard) {
    if (!Array.isArray(serverBoard)) {
      throw new Error('Server board is not an array.');
    }

    const nextBoard = Array.from(
      { length: GRID_COLUMNS },
      () => Array(GRID_ROWS).fill(null)
    );

    for (let serverRow = 0; serverRow < GRID_ROWS; serverRow++) {
      const rowData = serverBoard[serverRow];

      if (!Array.isArray(rowData)) {
        throw new Error(`Server board row ${serverRow} is invalid.`);
      }

      for (let column = 0; column < GRID_COLUMNS; column++) {
        const localRow = SERVER_ROW_ZERO_IS_TOP
          ? GRID_ROWS - 1 - serverRow
          : serverRow;

        nextBoard[column][localRow] =
          serverValueToPlayer(rowData[column]);
      }
    }

    return nextBoard;
  }

  function boardsEqual(a, b) {
    if (a.length !== b.length) return false;

    for (let column = 0; column < GRID_COLUMNS; column++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        if (a[column][row] !== b[column][row]) {
          return false;
        }
      }
    }

    return true;
  }

  function getBoardDifferences(nextBoard) {
    const additions = [];
    let requiresRebuild = false;

    for (let column = 0; column < GRID_COLUMNS; column++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const previous = boardState[column][row];
        const next = nextBoard[column][row];

        if (previous === null && next !== null) {
          additions.push([column, row, next]);
        } else if (previous !== next) {
          requiresRebuild = true;
        }
      }
    }

    return {
      additions,
      requiresRebuild
    };
  }

  function clearVisualPieces() {
    for (const entry of placedPieces) {
      boardRoot.remove(entry.piece);
    }

    placedPieces.length = 0;
    winningPieces.clear();
  }

  function rebuildVisualBoard() {
    clearVisualPieces();

    for (let column = 0; column < GRID_COLUMNS; column++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const player = boardState[column][row];

        if (!player) continue;

        const piece = clonePieceModel(player);
        piece.position.copy(
          getGridPosition(column, row)
        );

        boardRoot.add(piece);

        placedPieces.push({
          piece,
          column,
          row,
          player
        });
      }
    }
  }

  function findAnyWinningLine() {
    for (let column = 0; column < GRID_COLUMNS; column++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const player = boardState[column][row];

        if (!player) continue;

        const winningCells =
          findWinningCells(column, row, player);

        if (winningCells.length >= 4) {
          return {
            winningCells,
            player
          };
        }
      }
    }

    return null;
  }

  function applyServerGameState(serverTurn) {
    onlineServerTurn = serverTurn;
    currentPlayer =
      turnValueToPlayer(serverTurn) || currentPlayer;

    const winningLine = findAnyWinningLine();

    if (winningLine) {
      finishGameWithWinner(
        winningLine.winningCells,
        winningLine.player
      );
      return;
    }

    if (isBoardFull()) {
      gameOver = true;
      winningPieces.clear();
      setStatus(
        'Draw — waiting for server reset',
        'neutral'
      );
      return;
    }

    gameOver = false;
    winningPieces.clear();
    updateOnlineStatus();
    updatePreview();
  }

  async function fetchBoardState(force = false) {
    if (!ONLINE_PLAY) return;

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      onlineReady = false;
      setStatus(
        'Online mode is missing Supabase configuration.',
        'neutral'
      );
      return;
    }

    if (
      onlinePollInFlight &&
      !force
    ) {
      return;
    }

    onlinePollInFlight = true;

    try {
      const response = await fetch(
        GAME_STATE_REST_URL,
        {
          method: 'GET',
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Accept: 'application/json',
            'Cache-Control': 'no-cache'
          },
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        throw new Error(
          `Game state request failed (${response.status}).`
        );
      }

      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Game state was not returned.');
      }

      const state = data[0];

      if (
        !Array.isArray(state.board) ||
        typeof state.current_turn === 'undefined'
      ) {
        throw new Error('Game state response is missing fields.');
      }

      const nextBoard =
        convertServerBoard(state.board);

      const turnValue =
        Number(state.current_turn);

      if (!onlineHasInitialState) {
        boardState = nextBoard;
        rebuildVisualBoard();
        onlineHasInitialState = true;
        onlineServerTurn = turnValue;
        onlineReady = true;
        applyServerGameState(turnValue);
        return;
      }

      const {
        additions,
        requiresRebuild
      } = getBoardDifferences(nextBoard);

      onlinePublicScore = Number(state.public_score) || 0;

      onlineOwnerScore = Number(state.owner_score) || 0;

      updateScoreDisplay();

      onlineReady = true;

      if (requiresRebuild) {
        boardState = nextBoard;
        rebuildVisualBoard();
        isDropping = false;
      } else if (
        additions.length > 0
      ) {
        boardState = nextBoard;
        isDropping = true;

        let remaining = additions.length;

        const onAnimationComplete = () => {
          remaining--;

          if (remaining <= 0) {
            isDropping = false;
            applyServerGameState(turnValue);
          }
        };

        for (
          const [column, row, player]
          of additions
        ) {
          const piece = clonePieceModel(player);

          animatePieceIntoCell(
            piece,
            column,
            row,
            player,
            false,
            onAnimationComplete
          );
        }

        onlineServerTurn = turnValue;
        currentPlayer =
          turnValueToPlayer(turnValue) || currentPlayer;

        updatePreview();
        return;
      } else if (!boardsEqual(boardState, nextBoard)) {
        boardState = nextBoard;
        rebuildVisualBoard();
        isDropping = false;
      }

      applyServerGameState(turnValue);
    } catch (error) {
      console.error('Failed to fetch Connect Four state:', error);

      onlineReady = false;

      setStatus(
        'Unable to reach the game server.',
        'neutral'
      );
    } finally {
      onlinePollInFlight = false;
    }
  }

  function startOnlinePolling() {
    if (!ONLINE_PLAY || onlinePollInterval) {
      return;
    }

    onlinePollInterval = window.setInterval(
      () => fetchBoardState(false),
      ONLINE_POLL_INTERVAL_MS
    );

    window.addEventListener(
      'pagehide',
      stopOnlinePolling,
      { once: true }
    );
  }

  function stopOnlinePolling() {
    if (onlinePollInterval) {
      window.clearInterval(
        onlinePollInterval
      );
      onlinePollInterval = null;
    }
  }

  function updateOnlineStatus() {
    if (!ONLINE_PLAY) return;

    if (!onlineReady) {
      setStatus(
        'Connecting to game server...',
        'neutral'
      );
      return;
    }

    if (onlineMovePending) {
      setStatus(
        'Submitting move...',
        'neutral'
      );
      return;
    }

    if (gameOver) {
      return;
    }

    const player = turnValueToPlayer(
      onlineServerTurn
    );

    if (player === ONLINE_LOCAL_PLAYER) {
      setStatus(
        `Your turn (${player === 'red' ? 'Red' : 'Yellow'})`,
        player
      );
    } else if (player) {
      setStatus(
        `Waiting for ${player === 'red' ? 'Red' : 'Yellow'}...`,
        player
      );
    } else {
      setStatus(
        'Waiting for server...',
        'neutral'
      );
    }
  }

  async function submitOnlineMove(column) {
    if (
      onlineMovePending ||
      !canLocalPlayerMove()
    ) {
      return;
    }

    onlineMovePending = true;

    if (previewPiece) {
      previewPiece.visible = false;
    }

    updateOnlineStatus();

    try {
      const response = await fetch(
        `${EDGE_FUNCTION_URL}?slot=${column}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_PUBLISHABLE_KEY
          }
        }
      );

      const contentType =
        response.headers.get('content-type') || '';

      let result = null;
      let responseText = '';

      if (
        contentType.includes('application/json')
      ) {
        result = await response.json();
      } else {
        responseText = await response.text();
      }

      if (!response.ok) {
        throw new Error(
          result?.error ||
          responseText ||
          `Move request failed (${response.status}).`
        );
      }

      if (result?.error) {
        throw new Error(result.error);
      }

      // The edge function response is only an acknowledgement.
      // Fetch the actual database state and animate from that.
      await fetchBoardState(true);
    } catch (error) {
      console.error(
        'Connect Four move failed:',
        error
      );

      setStatus(
        error.message || 'Move failed.',
        'neutral'
      );

      await fetchBoardState(true);
    } finally {
      onlineMovePending = false;
      updateOnlineStatus();
      updatePreview();
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                               WIN DETECTION                                */
  /* -------------------------------------------------------------------------- */

  function findWinningCells(column, row, player) {
    const directions = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1]
    ];

    const winningCoordinates = new Set();

    for (const [dx, dy] of directions) {
      const line = [];
      const backwards = collectDirection(
        column,
        row,
        -dx,
        -dy,
        player
      ).reverse();

      line.push(...backwards);
      line.push([column, row]);
      line.push(...collectDirection(column, row, dx, dy, player));

      if (line.length >= 4) {
        for (const [x, y] of line) {
          winningCoordinates.add(`${x},${y}`);
        }
      }
    }

    return [...winningCoordinates].map((key) => {
      const [x, y] = key.split(',').map(Number);
      return [x, y];
    });
  }

  function collectDirection(column, row, dx, dy, player) {
    const result = [];
    let x = column + dx;
    let y = row + dy;

    while (
      x >= 0 &&
      x < GRID_COLUMNS &&
      y >= 0 &&
      y < GRID_ROWS &&
      boardState[x][y] === player
    ) {
      result.push([x, y]);
      x += dx;
      y += dy;
    }

    return result;
  }

  function finishGameWithWinner(
    winningCells,
    winner = currentPlayer
  ) {
    gameOver = true;
    isDropping = false;
    winningPieces.clear();

    currentPlayer = winner;

    for (const [column, row] of winningCells) {
      const placed = placedPieces.find(
        (entry) => entry.column === column && entry.row === row
      );

      if (placed) {
        winningPieces.add(placed.piece);
      }
    }

    winBlinkOn = true;
    setStatus(
      ONLINE_PLAY
        ? `${currentPlayer === 'red' ? 'Red' : 'Yellow'} wins — waiting for server reset`
        : `${currentPlayer === 'red' ? 'Red' : 'Yellow'} wins — click here to reset`,
      currentPlayer
    );
  }

  function updateWinBlink(time) {
    if (!gameOver || winningPieces.size === 0) return;

    const phase =
      Math.floor(time / WIN_BLINK_PERIOD_MS) % 2 === 0;
    if (phase === winBlinkOn) return;

    winBlinkOn = phase;
    for (const piece of winningPieces) {
      piece.visible = winBlinkOn;
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                                  HOVER                                     */
  /* -------------------------------------------------------------------------- */

  function getColumnFromPointer(event) {
    if (!renderer || !interactionPlane) {
      return null;
    }

    const rect =
      renderer.domElement.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    pointer.x =
      ((event.clientX - rect.left) / rect.width) * 2 - 1;

    pointer.y =
      -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    const intersections =
      raycaster.intersectObject(
        interactionPlane,
        false
      );

    if (intersections.length === 0) {
      return null;
    }

    localIntersection.copy(
      intersections[0].point
    );

    // Convert the world-space hit back into the
    // exact local coordinate system used by GRID_*.
    boardRoot.worldToLocal(localIntersection);

    const gridX =
      localIntersection.x -
      (GRID_ORIGIN_X + PIECE_OFFSET_X);

    const column = Math.round(
      gridX / GRID_COLUMN_SPACING
    );

    if (
      column < 0 ||
      column >= GRID_COLUMNS
    ) {
      return null;
    }

    return column;
  }

  function updateHoveredColumn(event) {
    if (DEBUG_FOUR_CORNERS || gameOver) {
      return;
    }

    lastPointerPosition.x = event.clientX;
    lastPointerPosition.y = event.clientY;
    hasPointerPosition = true;

    const column =
      getColumnFromPointer(event);

    if (column !== hoveredColumn) {
      hoveredColumn = column;
      updatePreview();
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                              POINTER CONTROLS                              */
  /* -------------------------------------------------------------------------- */

  function setupPointerEvents() {
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('pointerleave', onPointerLeave);
  }

  function onPointerDown(event) {
    activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    updateHoveredColumn(event);

    if (activePointers.size === 1) {
      isDragging = false;
      dragStart.x = event.clientX;
      dragStart.y = event.clientY;
      previousPointer.x = event.clientX;
      previousPointer.y = event.clientY;
    }

    container.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    updateHoveredColumn(event);

    if (!activePointers.has(event.pointerId)) return;

    activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    const pointers = [...activePointers.values()];

    if (pointers.length === 2) {
      const dx = pointers[0].x - pointers[1].x;
      const dy = pointers[0].y - pointers[1].y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (previousPinchDistance !== null) {
        const delta = previousPinchDistance - distance;
        targetDistance += delta * 0.05;
        targetDistance = THREE.MathUtils.clamp(
          targetDistance,
          CAMERA_MIN_DISTANCE,
          CAMERA_MAX_DISTANCE
        );
      }

      previousPinchDistance = distance;
      return;
    }

    previousPinchDistance = null;

    const totalDragX = event.clientX - dragStart.x;
    const totalDragY = event.clientY - dragStart.y;

    if (
      Math.abs(totalDragX) > DRAG_THRESHOLD ||
      Math.abs(totalDragY) > DRAG_THRESHOLD
    ) {
      isDragging = true;
    }

    if (!isDragging) return;

    const deltaX = event.clientX - previousPointer.x;
    const deltaY = event.clientY - previousPointer.y;

    previousPointer.x = event.clientX;
    previousPointer.y = event.clientY;

    targetAzimuth -= deltaX * ORBIT_SENSITIVITY;
    targetElevation += deltaY * ORBIT_SENSITIVITY;
    targetElevation = THREE.MathUtils.clamp(
      targetElevation,
      CAMERA_MIN_ELEVATION,
      CAMERA_MAX_ELEVATION
    );
  }

  function onPointerUp(event) {
    const wasClick = !isDragging && activePointers.size === 1;

    if (wasClick && !DEBUG_FOUR_CORNERS) {
      if (gameOver) {
        if (ONLINE_PLAY) {
          // The server is authoritative. A client does not locally
          // erase the online board because polling would restore it.
          fetchBoardState(true);
        } else {
          clearBoard();
        }
      } else {
        const column = getColumnFromPointer(event);
        placePiece(column);
      }
    }

    activePointers.delete(event.pointerId);
    previousPinchDistance = null;

    if (container.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }

    isDragging = false;
  }

  function onPointerLeave() {
    if (activePointers.size === 0 && !gameOver) {
      hoveredColumn = null;
      updatePreview();
    }
  }

  function onWheel(event) {
    event.preventDefault();
    targetDistance += event.deltaY * ZOOM_SENSITIVITY;
    targetDistance = THREE.MathUtils.clamp(
      targetDistance,
      CAMERA_MIN_DISTANCE,
      CAMERA_MAX_DISTANCE
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                               STATUS / RESET                               */
  /* -------------------------------------------------------------------------- */

  function setupStatusInteraction() {
    statusElement.addEventListener('click', () => {
      if (!gameOver) return;

      if (ONLINE_PLAY) {
        fetchBoardState(true);
      } else {
        clearBoard();
      }
    });
  }

  function setStatus(text, type) {
    if (!statusElement) return;

    statusElement.textContent = text;
    statusElement.classList.remove(
      'cursor-pointer',
      'text-red-600',
      'text-yellow-600',
      'text-gray-700'
    );

    if (gameOver) {
      statusElement.classList.add('cursor-pointer');
    }

    if (type === 'red') {
      statusElement.classList.add('text-red-600');
    } else if (type === 'yellow') {
      statusElement.classList.add('text-yellow-600');
    } else {
      statusElement.classList.add('text-gray-700');
    }
  }

  function updateScoreDisplay() {
    if (publicScoreElement) {
      publicScoreElement.textContent =
        String(onlinePublicScore);
    }

    if (ownerScoreElement) {
      ownerScoreElement.textContent =
        String(onlineOwnerScore);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                                DEBUG MODE                                  */
  /* -------------------------------------------------------------------------- */

  function createDebugPieces() {
    const corners = [
      [0, 0, 'red'],
      [GRID_COLUMNS - 1, 0, 'yellow'],
      [0, GRID_ROWS - 1, 'yellow'],
      [GRID_COLUMNS - 1, GRID_ROWS - 1, 'red']
    ];

    for (const [column, row, player] of corners) {
      const piece = clonePieceModel(player);
      piece.position.copy(getGridPosition(column, row));
      boardRoot.add(piece);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                                  CAMERA                                    */
  /* -------------------------------------------------------------------------- */

  function updateCamera() {
    camera.position.set(
      cameraTarget.x +
        cameraDistance *
          Math.cos(elevation) *
          Math.sin(azimuth),
      cameraTarget.y + cameraDistance * Math.sin(elevation),
      cameraTarget.z +
        cameraDistance *
          Math.cos(elevation) *
          Math.cos(azimuth)
    );

    camera.lookAt(cameraTarget);
  }

  /* -------------------------------------------------------------------------- */
  /*                                  RESIZE                                    */
  /* -------------------------------------------------------------------------- */

  function onResize() {
    if (!container || !camera || !renderer) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / Math.max(height, 1);

    camera.left = (CAMERA_FRUSTUM_SIZE * aspect) / -2;
    camera.right = (CAMERA_FRUSTUM_SIZE * aspect) / 2;
    camera.top = CAMERA_FRUSTUM_SIZE / 2;
    camera.bottom = CAMERA_FRUSTUM_SIZE / -2;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
  }

  /* -------------------------------------------------------------------------- */
  /*                                ANIMATION                                   */
  /* -------------------------------------------------------------------------- */

  let previousTime = 0;

  function animate(time) {
    requestAnimationFrame(animate);

    const deltaTime = Math.min(
      (time - previousTime) * 0.001,
      0.1
    );
    previousTime = time;

    azimuth = THREE.MathUtils.lerp(
      azimuth,
      targetAzimuth,
      1 - Math.pow(1 - CAMERA_SMOOTHING, deltaTime * 60)
    );

    elevation = THREE.MathUtils.lerp(
      elevation,
      targetElevation,
      1 - Math.pow(1 - CAMERA_SMOOTHING, deltaTime * 60)
    );

    cameraDistance = THREE.MathUtils.lerp(
      cameraDistance,
      targetDistance,
      1 - Math.pow(1 - CAMERA_SMOOTHING, deltaTime * 60)
    );

    updateCamera();

    if (
      hasPointerPosition &&
      !DEBUG_FOUR_CORNERS &&
      !gameOver
    ) {
      updateHoveredColumn({
        clientX: lastPointerPosition.x,
        clientY: lastPointerPosition.y
      });
    }

    updateWinBlink(time);

    renderer.render(scene, camera);
  }

  /* -------------------------------------------------------------------------- */
  /*                               WEBGL CHECK                                  */
  /* -------------------------------------------------------------------------- */

  function isWebGLAvailable() {
    try {
      const canvas = document.createElement('canvas');
      return !!(
        window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl'))
      );
    } catch {
      return false;
    }
  }

  init().then(() => {
    if (initialized) {
      requestAnimationFrame(animate);
    }
  });
