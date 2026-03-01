// MAIN.JS - Application Orchestrator

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// Core
import { SceneManager } from './core/Scene.js';
import { RendererManager } from './core/Renderer.js';
import { CameraManager } from './core/Camera.js';

import { MaterialManager } from './materials/MaterialManager.js';
import { ModelManager } from './models/ModelManager.js';

import { UVEditor } from './ui/UVEditor.js';
import { ControlsManager } from './ui/Controls.js';

// Props & Scenes
import { PropManager } from './props/PropManager.js';
import { CustomSceneStorage } from './scenes/CustomSceneStorage.js';

// Utils
import { log, logError, logSuccess, logWarn } from './utils/logger.js';
import { TextureCompositor } from './utils/TextureCompositor.js';
import { centerAndFrameModel, cleanupObject } from './utils/helpers.js';

// Config
import { CONFIG, MODEL_PATHS, PROP_PATHS } from './config.js';

// Scenes
import { initScenes, loadScene, getSceneNames } from './scenes.js';

//═══════════════════════════════════════════════════════════════
// INITIALIZATION
//═══════════════════════════════════════════════════════════════

const container = document.getElementById('scene-view-placeholder');

const sceneManager = new SceneManager();
const rendererManager = new RendererManager(container);
const cameraManager = new CameraManager(container);
cameraManager.setupControls(rendererManager.getDomElement());

const materialManager = new MaterialManager();
const modelManager = new ModelManager(log);
const uvEditor = new UVEditor(rendererManager, log, modelManager, materialManager);

const propManager = new PropManager(
  sceneManager.getScene(),
  cameraManager.getCamera(),
  rendererManager.getRenderer(),
  cameraManager.getControls(),
  log
);

const sceneStorage = new CustomSceneStorage();
sceneStorage.init();

const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();

let activeModel = null;
let activeMesh = null;
let currentEnvironment = null;
let currentBackground = null;

//═══════════════════════════════════════════════════════════════
// SCENE SETUP
//═══════════════════════════════════════════════════════════════

log('RenderDeck initialized.');

/**
 * Process a raw HDR equirectangular texture through PMREMGenerator
 * so Three.js PBR materials get proper filtered environment reflections.
 * The raw texture is kept as-is for the panoramic background.
 */
function createHDREnvironment(rawTexture) {
  const pmrem = new THREE.PMREMGenerator(rendererManager.getRenderer());
  const envMap = pmrem.fromEquirectangular(rawTexture).texture;
  pmrem.dispose();
  return envMap;
}

initScenes((name, rawTexture) => {
  const envMap = createHDREnvironment(rawTexture);
  sceneManager.setEnvironment(envMap);
  sceneManager.getScene().background = rawTexture;
  currentEnvironment = name;
  currentBackground = 'hdr';
  log(`Scene: ${name}`);
});

registerBuiltInModels();

function registerBuiltInModels() {
  Object.entries(MODEL_PATHS).forEach(([key, cfg]) => {
    if (key !== 'BASE_PATH') {
      const displayName = key.split('_')
        .map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
      modelManager.registerModel(displayName, cfg);
    }
  });
}

//═══════════════════════════════════════════════════════════════
// MODEL LOADING
//═══════════════════════════════════════════════════════════════

async function loadModel(name, onLoaded = null) {
  const modelData = await modelManager.getModel(name);
  if (!modelData) { logError(`Model not found: ${name}`); return; }
  cleanupActiveModel();
  if (modelData.type === 'custom') {
    await loadCustomModel(name, modelData, onLoaded);
  } else {
    await loadRegularModel(name, modelData, onLoaded);
  }
}

async function loadCustomModel(name, modelData, onLoaded = null) {
  log(`Loading custom model: ${name}…`);
  const loadingPaths = await modelManager.getLoadingPaths(modelData.basedOn);
  if (!loadingPaths) { logError(`Base model not found: ${modelData.basedOn}`); return; }

  const objPath = loadingPaths.type === 'path'
    ? loadingPaths.basePath + loadingPaths.obj : loadingPaths.obj;

  objLoader.load(objPath, (object) => {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.isCustomModel = true;
      if (!activeMesh) activeMesh = child;

      const presetName = modelData.materialPreset || 'Wood';
      const material = materialManager.getPreset(presetName);
      materialManager.applyEnvironment(material, sceneManager.getScene().environment);
      child.material = material;

      if (modelData.materialProperties) {
        materialManager.applySavedProperties(child.material, modelData.materialProperties);
      }

      if (child.material && modelData.overlayImages?.length > 0) {
        TextureCompositor.createCompositeTexture(child.material.map, modelData.overlayImages)
          .then(tex => {
            if (child.material.map) child.material.map.dispose();
            child.material.map = tex;
            child.material.needsUpdate = true;
          })
          .catch(err => logError(`Composite failed: ${err.message}`));
      }
    });

    sceneManager.add(object);
    activeModel = object;
    propManager.setMainModel(object);
    centerAndFrameModel(object, cameraManager);
    if (activeMesh?.material) controls.syncMaterialUI(activeMesh.material);
    log(`${name} loaded.`);
    // Initialize UV editor for this custom model
    if (activeMesh) {
      uvEditor.open(activeMesh, name, modelData.materialPreset || 'Wood');
    }
    if (onLoaded) onLoaded(object);
  },
  (xhr) => { if (xhr.lengthComputable && xhr.total > 0) log(`Loading… ${((xhr.loaded/xhr.total)*100).toFixed(0)}%`); },
  (err) => logError(`OBJ load failed: ${err}`));
}

async function loadRegularModel(name, modelData, onLoaded = null) {
  log(`Loading ${name}…`);
  const loadingPaths = await modelManager.getLoadingPaths(name);
  if (!loadingPaths) { logError(`No paths for ${name}`); return; }

  function loadOBJ(materials = null) {
    if (materials) objLoader.setMaterials(materials);
    const objPath = loadingPaths.type === 'path'
      ? loadingPaths.basePath + loadingPaths.obj : loadingPaths.obj;

    objLoader.load(objPath, (object) => {
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        if (!activeMesh) activeMesh = child;
      });
      sceneManager.add(object);
      activeModel = object;
      propManager.setMainModel(object);
      centerAndFrameModel(object, cameraManager);
      applyMaterialPreset('Wood');
      log(`${name} loaded.`);
      // Initialize UV editor for this model
      if (activeMesh) {
        uvEditor.open(activeMesh, name, 'Wood');
      }
      if (onLoaded) onLoaded(object);
    },
    (xhr) => { if (xhr.lengthComputable && xhr.total > 0) log(`Loading… ${((xhr.loaded/xhr.total)*100).toFixed(0)}%`); },
    (err) => logError(`OBJ load failed: ${err}`));
  }

  if (loadingPaths.mtl) {
    const mtlPath = loadingPaths.type === 'path'
      ? loadingPaths.basePath + loadingPaths.mtl : loadingPaths.mtl;
    if (loadingPaths.type === 'path') {
      mtlLoader.setPath(loadingPaths.basePath);
      mtlLoader.load(loadingPaths.mtl,
        (m) => { m.preload(); loadOBJ(m); },
        undefined,
        () => loadOBJ());
    } else {
      fetch(mtlPath).then(r => r.text())
        .then(t => { const m = mtlLoader.parse(t, ''); m.preload(); loadOBJ(m); })
        .catch(() => loadOBJ());
    }
  } else {
    loadOBJ();
  }
}

function cleanupActiveModel() {
  if (activeModel) {
    propManager.setMainModel(null);
    sceneManager.remove(activeModel);
    cleanupObject(activeModel);
    activeModel = null;
    activeMesh = null;
  }
}

//═══════════════════════════════════════════════════════════════
// MATERIAL MANAGEMENT
//═══════════════════════════════════════════════════════════════

function applyMaterialPreset(presetName) {
  if (!activeModel) return;
  activeModel.traverse((child) => {
    if (!child.isMesh) return;
    if (child.userData?.isCustomModel) {
      if (sceneManager.getScene().environment && child.material) {
        child.material.envMap = sceneManager.getScene().environment;
        child.material.needsUpdate = true;
      }
      return;
    }
    const material = materialManager.getPreset(presetName);
    materialManager.applyEnvironment(material, sceneManager.getScene().environment);
    if (child.material) materialManager.dispose(child.material);
    child.material = material;
    if (!activeMesh) activeMesh = child;
    child.material.needsUpdate = true;
  });
  if (activeMesh?.material) controls.syncMaterialUI(activeMesh.material);
  
  // Update UV editor's base texture to match the new material
  if (activeMesh?.material?.map) {
    uvEditor.baseTexture = activeMesh.material.map;
    uvEditor.currentMaterialPreset = presetName;
    uvEditor._renderPreview();
  }
  
  log(`Preset: ${presetName}`);
}

function updateMaterialProperty(property, value) {
  if (!activeMesh?.material) return;
  const mat = activeMesh.material;
  const colorProps = ['color', 'specularColor', 'sheenColor', 'emissive', 'attenuationColor'];
  if (colorProps.includes(property)) {
    mat[property].set(value);
  } else {
    mat[property] = value;
  }
  if (property === 'opacity') mat.transparent = value < 1.0;
  if (property === 'transmission') mat.transparent = value > 0;
  mat.needsUpdate = true;
}

//═══════════════════════════════════════════════════════════════
// CAMERA CONTROLS
//═══════════════════════════════════════════════════════════════

// Sensor sizes in mm (width × height)
const SENSOR_SIZES = {
  fullframe: { w: 36, h: 24 },
  'aps-c':   { w: 23.5, h: 15.6 },
  mft:       { w: 17.3, h: 13 }
};

// State for camera settings
const camState = {
  type: 'perspective',
  focalLength: 50,
  sensorKey: 'fullframe',
  near: 0.1,
  far: 2000,
  exposure: 1.0,
  toneMapping: 'aces',
  dofEnabled: false,
  dofFocus: 5.0,
  dofAperture: 25,  // 1/aperture used by BokehPass
};

function computeFOV(focalLength, sensorKey) {
  const sensor = SENSOR_SIZES[sensorKey] || SENSOR_SIZES.fullframe;
  // Vertical FOV: 2 * atan(sensorHeight / (2 * focalLength))
  return 2 * Math.atan(sensor.h / (2 * focalLength)) * (180 / Math.PI);
}

function applyCameraSettings() {
  const cam = cameraManager.getCamera();
  const renderer = rendererManager.getRenderer();

  if (camState.type === 'perspective') {
    cam.fov = computeFOV(camState.focalLength, camState.sensorKey);
    cam.near = camState.near;
    cam.far = camState.far;
    cam.updateProjectionMatrix();
  }

  // Tone mapping
  const TM = {
    none: THREE.NoToneMapping,
    aces: THREE.ACESFilmicToneMapping,
    reinhard: THREE.ReinhardToneMapping,
    cineon: THREE.CineonToneMapping,
  };
  renderer.toneMapping = TM[camState.toneMapping] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = camState.exposure;
}

function setupCameraUI() {
  // Helpers: link slider ↔ input
  const link = (sliderId, inputId, callback) => {
    const s = document.getElementById(sliderId);
    const i = document.getElementById(inputId);
    if (!s || !i) return;
    s.addEventListener('input', () => { i.value = s.value; callback(parseFloat(s.value)); });
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (!isNaN(v)) { s.value = v; callback(v); }
    });
  };

  // Camera type
  const typeSelect = document.getElementById('camera-type-select');
  if (typeSelect) {
    typeSelect.addEventListener('change', (e) => {
      camState.type = e.target.value;
      // Orthographic camera swap would need deeper integration;
      // for now we just update FOV approach or set very high FOV
      if (camState.type === 'orthographic') {
        cameraManager.getCamera().fov = 1; // Near-orthographic
      } else {
        cameraManager.getCamera().fov = computeFOV(camState.focalLength, camState.sensorKey);
      }
      cameraManager.getCamera().updateProjectionMatrix();
    });
  }

  // Lens / focal length
  const lensSelect = document.getElementById('lens-mm-select');
  if (lensSelect) {
    lensSelect.addEventListener('change', (e) => {
      camState.focalLength = parseFloat(e.target.value);
      applyCameraSettings();
      log(`Lens: ${camState.focalLength}mm`);
    });
  }

  // Film / sensor gauge
  const filmSelect = document.getElementById('film-gauge-select');
  if (filmSelect) {
    filmSelect.addEventListener('change', (e) => {
      camState.sensorKey = e.target.value;
      applyCameraSettings();
      log(`Sensor: ${e.target.value}`);
    });
  }

  // Near clip
  link('near-slider', 'near-input', (v) => {
    camState.near = v;
    cameraManager.getCamera().near = v;
    cameraManager.getCamera().updateProjectionMatrix();
  });

  // Far clip
  link('far-slider', 'far-input', (v) => {
    camState.far = v;
    cameraManager.getCamera().far = v;
    cameraManager.getCamera().updateProjectionMatrix();
  });

  // Tone mapping
  const toneSelect = document.getElementById('tone-mapping-select');
  if (toneSelect) {
    toneSelect.addEventListener('change', (e) => {
      camState.toneMapping = e.target.value;
      applyCameraSettings();
    });
  }

  // Exposure
  link('exposure-slider', 'exposure-input', (v) => {
    camState.exposure = v;
    rendererManager.getRenderer().toneMappingExposure = v;
  });

  // DOF toggle
  const dofToggle = document.getElementById('cam-toggle-dof');
  if (dofToggle) {
    dofToggle.addEventListener('change', (e) => {
      camState.dofEnabled = e.target.checked;
      log(`DOF: ${camState.dofEnabled ? 'on' : 'off'}`);
      // Full DOF (BokehPass) would require EffectComposer integration in Renderer
      // Noted for future post-processing implementation
    });
  }

  // DOF focus distance
  link('cam-dof-focus-slider', 'cam-dof-focus-input', (v) => {
    camState.dofFocus = v;
  });

  // DOF aperture/strength
  link('cam-dof-strength-slider', 'cam-dof-strength-input', (v) => {
    camState.dofAperture = v;
  });

  // Apply initial camera settings from UI defaults
  applyCameraSettings();
}

//═══════════════════════════════════════════════════════════════
// UI CONTROLS
//═══════════════════════════════════════════════════════════════

const controls = new ControlsManager({
  onModelChange: (name) => loadModel(name),

  onMaterialChange: (preset) => applyMaterialPreset(preset),

  onSceneChange: (sceneName) => {
    loadScene(sceneName, (name, rawTexture) => {
      const envMap = createHDREnvironment(rawTexture);
      sceneManager.setEnvironment(envMap);
      sceneManager.getScene().background = rawTexture;
      log(`Scene: ${name}`);
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.envMap = envMap;
            child.material.needsUpdate = true;
          }
        });
      }
    });
  },

  onMaterialPropertyChange: (property, value) => {
    updateMaterialProperty(property, value);
  },

  onApplyDesign: () => {
    if (!activeMesh) { logError('No model loaded'); return; }
    // Just apply the texture to model - don't call open() which would prompt for name
    uvEditor.applyTextureToModel();
  },

  onResetTexture: () => {
    uvEditor.resetTexture();
  },

  onUploadModel: async (files) => {
    if (!files?.length) return;
    const result = await modelManager.addModelFromFiles(files);
    if (result.success) {
      logSuccess(`Model added: ${result.name}`);
      result.warnings.forEach(w => logWarn(w));
      await updateModelList();
      loadModel(result.name);
    } else {
      result.errors.forEach(e => logError(e));
    }
  },

  onExport: async () => {
    const name = getCurrentModelName();
    if (!name) { logError('No model selected'); return; }
    const data = await modelManager.getModel(name);
    if (data?.type === 'custom') {
      await modelManager.exportCustomModel(name);
      logSuccess(`Exported: ${name}`);
    } else {
      logError('Only custom models can be exported');
    }
  },

  onImport: async (files) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.name.endsWith('.json') && !file.name.endsWith('.renderdeck.json')) {
      logError('Please select a .json or .renderdeck.json file');
      return;
    }
    const result = await modelManager.importCustomModel(file);
    if (result.success) {
      logSuccess(`Imported: ${result.name}`);
      await updateModelList();
      loadModel(result.name);
    } else {
      logError(`Import failed: ${result.error}`);
    }
  },

  onClearCustom: async () => {
    if (!confirm('Clear all custom models? This cannot be undone!')) return;
    const result = await modelManager.clearAllCustomModels();
    if (result.success) {
      logSuccess(`Cleared ${result.count} custom model(s)`);
      await updateModelList();

      // Reset the material preset dropdown to its placeholder
      const matSelect = document.getElementById('material-select');
      if (matSelect) matSelect.selectedIndex = 0;

      // Load the first built-in model — this applies the Wood default preset
      const first = Object.keys(MODEL_PATHS).find(k => k !== 'BASE_PATH');
      if (first) {
        const name = first.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
        // loadModel → loadRegularModel → applyMaterialPreset('Wood') → syncMaterialUI
        // so the UI will fully reset to Wood defaults automatically
        loadModel(name);
      }
    }
  },
});

function getCurrentModelName() {
  return document.getElementById('object-select')?.value
    || document.getElementById('model-select')?.value || '';
}

function getCurrentMaterialPreset() {
  return document.getElementById('material-select')?.value || 'Wood';
}

async function updateModelList() {
  const categories = await modelManager.getModelNamesByCategory();
  controls.updateModelSelect(categories);
}

function updateSceneList() {
  controls.updateSceneSelect(getSceneNames());
}

function updateMaterialPresetList() {
  controls.updateMaterialPresetSelect(materialManager.getPresetNames());
}

window.updateModelSelect = updateModelList;
window.switchToModel = (name) => {
  const sel = document.getElementById('object-select') || document.getElementById('model-select');
  if (sel) { sel.value = name; loadModel(name); }
};

//═══════════════════════════════════════════════════════════════
// DRAG & DROP
//═══════════════════════════════════════════════════════════════

container.addEventListener('dragover', (e) => {
  e.preventDefault(); e.stopPropagation();
  container.classList.add('drag-over');
});
container.addEventListener('dragleave', (e) => {
  e.preventDefault(); e.stopPropagation();
  container.classList.remove('drag-over');
});
container.addEventListener('drop', async (e) => {
  e.preventDefault(); e.stopPropagation();
  container.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;
  const result = await modelManager.addModelFromFiles(files);
  if (result.success) {
    logSuccess(`Model added: ${result.name}`);
    result.warnings.forEach(w => logWarn(w));
    await updateModelList();
    loadModel(result.name);
  } else {
    result.errors.forEach(e => logError(e));
  }
});


//═══════════════════════════════════════════════════════════════
// POST-PROCESSING UI (Setting 6)
//═══════════════════════════════════════════════════════════════

function setupPostFXUI() {
  const rm = rendererManager; // shorthand

  // Helper: link slider <-> number input
  const link = (sliderId, inputId, callback) => {
    const s = document.getElementById(sliderId);
    const i = document.getElementById(inputId);
    if (!s || !i) return;
    s.addEventListener('input', () => { i.value = s.value; callback(parseFloat(s.value)); });
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      if (!isNaN(v)) { s.value = v; callback(v); }
    });
  };

  // ── Global post-FX toggle (Setting 5 "Enable Post Effects") ──
  const globalToggle = document.getElementById('preview-toggle-postfx');
  if (globalToggle) {
    globalToggle.addEventListener('change', (e) => {
      rm.setPostFXEnabled(e.target.checked);
    });
    // Default: off until user enables or picks a preset
    rm.setPostFXEnabled(false);
  }

  // ── Preset select ─────────────────────────────────────────────
  const presetSelect = document.getElementById('postfx-preset-select');
  if (presetSelect) {
    presetSelect.addEventListener('change', (e) => {
      rm.applyPreset(e.target.value);
      // Also sync the global toggle in Setting 5
      if (globalToggle) globalToggle.checked = rm.postFXEnabled;
    });
  }

  // ── Individual effect toggles ─────────────────────────────────
  const bloomToggle = document.getElementById('post-toggle-bloom');
  if (bloomToggle) {
    bloomToggle.addEventListener('change', (e) => rm.setBloom(e.target.checked));
  }

  const vignetteToggle = document.getElementById('post-toggle-vignette');
  if (vignetteToggle) {
    vignetteToggle.addEventListener('change', (e) => rm.setVignette(e.target.checked));
  }

  const aoToggle = document.getElementById('post-toggle-ao');
  if (aoToggle) {
    aoToggle.addEventListener('change', (e) => rm.setSSAO(e.target.checked));
  }

  const motionBlurToggle = document.getElementById('post-toggle-motionblur');
  if (motionBlurToggle) {
    motionBlurToggle.addEventListener('change', (e) => rm.setMotionBlur(e.target.checked));
  }

  // ── Bloom controls ────────────────────────────────────────────
  link('bloom-strength-slider', 'bloom-strength-input', v => rm.setBloomStrength(v));
  link('bloom-radius-slider',   'bloom-radius-input',   v => rm.setBloomRadius(v));
  link('bloom-threshold-slider','bloom-threshold-input',v => rm.setBloomThreshold(v));

  // ── Vignette controls ─────────────────────────────────────────
  link('vignette-intensity-slider', 'vignette-intensity-input', v => rm.setVignetteIntensity(v));
  link('vignette-softness-slider',  'vignette-softness-input',  v => rm.setVignetteSoftness(v));

  // ── AO controls ───────────────────────────────────────────────
  link('ao-intensity-slider', 'ao-intensity-input', v => rm.setSSAOIntensity(v));
  link('ao-radius-slider',    'ao-radius-input',    v => rm.setSSAORadius(v));

  // ── Motion blur controls ──────────────────────────────────────
  link('motionblur-strength-slider', 'motionblur-strength-input', v => rm.setMotionBlurStrength(v));

  log('Post-processing UI ready.');
}

//═══════════════════════════════════════════════════════════════
// PREVIEW QUALITY UI (Setting 5)
//═══════════════════════════════════════════════════════════════

// Store helpers so we can toggle them
let gridHelper = null;
let axesHelper = null;

function setupPreviewQualityUI() {
  const renderer = rendererManager.getRenderer();
  const scene = sceneManager.getScene();

  // ── Shadows toggle ──
  const shadowsToggle = document.getElementById('preview-toggle-shadows');
  if (shadowsToggle) {
    shadowsToggle.addEventListener('change', (e) => {
      renderer.shadowMap.enabled = e.target.checked;
      // Need to update all materials
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.needsUpdate = true;
          }
        });
      }
      log(`Shadows: ${e.target.checked ? 'on' : 'off'}`);
    });
  }

  // ── Wireframe toggle ──
  const wireframeToggle = document.getElementById('preview-toggle-wireframe');
  if (wireframeToggle) {
    wireframeToggle.addEventListener('change', (e) => {
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.wireframe = e.target.checked;
            child.material.needsUpdate = true;
          }
        });
      }
      log(`Wireframe: ${e.target.checked ? 'on' : 'off'}`);
    });
  }

  // ── Helpers toggle (Grid + Axes) ──
  const helpersToggle = document.getElementById('preview-toggle-helpers');
  if (helpersToggle) {
    helpersToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        // Create and add helpers if they don't exist
        if (!gridHelper) {
          gridHelper = new THREE.GridHelper(10, 10, 0x888888, 0x444444);
          gridHelper.position.y = -0.01; // Slightly below origin
        }
        if (!axesHelper) {
          axesHelper = new THREE.AxesHelper(2);
        }
        scene.add(gridHelper);
        scene.add(axesHelper);
        log('Helpers: on');
      } else {
        // Remove helpers
        if (gridHelper) scene.remove(gridHelper);
        if (axesHelper) scene.remove(axesHelper);
        log('Helpers: off');
      }
    });
  }

  // ── Vertex Colors toggle ──
  const vertexColorsToggle = document.getElementById('preview-toggle-vertexcolors');
  if (vertexColorsToggle) {
    vertexColorsToggle.addEventListener('change', (e) => {
      if (activeModel) {
        activeModel.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.vertexColors = e.target.checked;
            child.material.needsUpdate = true;
          }
        });
      }
      log(`Vertex colors: ${e.target.checked ? 'on' : 'off'}`);
    });
  }

  // ── Resolution ──
  const resolutionSelect = document.getElementById('resolution-select');
  if (resolutionSelect) {
    resolutionSelect.addEventListener('change', (e) => {
      const [w, h] = e.target.value.split('x').map(Number);
      if (w && h) {
        // Change the WebGL render buffer to exactly the chosen resolution.
        // Use pixelRatio=1 so the buffer isn't multiplied by devicePixelRatio —
        // otherwise 4K becomes 7680×4320 on Retina and looks WORSE after
        // the browser crushes it back down to the CSS display size.
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);

        // Keep camera aspect in sync
        const cam = cameraManager.getCamera();
        cam.aspect = w / h;
        cam.updateProjectionMatrix();

        // Resize EffectComposer buffers
        if (rendererManager.composer) rendererManager.composer.setSize(w, h);

        // Override CSS !important so the canvas actually shows at the chosen
        // resolution (fit-to-container, preserving aspect ratio).
        // This beats the stylesheet's !important via an inline !important.
        const canvas = renderer.domElement;
        const cW = rendererManager.container.clientWidth  || 800;
        const cH = rendererManager.container.clientHeight || 450;
        const scale = Math.min(cW / w, cH / h, 1);
        canvas.style.setProperty('width',  Math.round(w * scale) + 'px', 'important');
        canvas.style.setProperty('height', Math.round(h * scale) + 'px', 'important');

        log(`Resolution: ${w} × ${h}`);
      }
    });
  }

  // ── Render Scale ──
  const renderScaleSelect = document.getElementById('render-scale-select');
  if (renderScaleSelect) {
    renderScaleSelect.addEventListener('change', (e) => {
      const scale = parseFloat(e.target.value);
      const baseDPR = window.devicePixelRatio || 1;
      renderer.setPixelRatio(Math.min(baseDPR * scale, 2));
      log(`Render scale: ${(scale * 100).toFixed(0)}%`);
    });
  }

  // ── Max DPR ──
  const maxDprSelect = document.getElementById('max-dpr-select');
  if (maxDprSelect) {
    maxDprSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'auto') {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      } else {
        renderer.setPixelRatio(parseFloat(val));
      }
      log(`Max DPR: ${val}`);
    });
  }

  // ── Anti-Aliasing mode ──
  const aaSelect = document.getElementById('aa-mode-select');
  if (aaSelect) {
    aaSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      // MSAA is baked into renderer at creation, but we can toggle FXAA
      if (mode === 'fxaa') {
        rendererManager.setFXAA(true);
      } else {
        rendererManager.setFXAA(false);
      }
      log(`Anti-aliasing: ${mode}`);
    });
  }

  // ── Shadow Quality ──
  const shadowQualitySelect = document.getElementById('shadow-quality-select');
  if (shadowQualitySelect) {
    shadowQualitySelect.addEventListener('change', (e) => {
      const quality = e.target.value;
      const sizes = { off: 0, low: 512, medium: 1024, high: 2048, ultra: 4096 };
      const size = sizes[quality] || 2048;
      
      if (quality === 'off') {
        renderer.shadowMap.enabled = false;
      } else {
        renderer.shadowMap.enabled = true;
        // Update shadow map size on lights
        scene.traverse((obj) => {
          if (obj.isLight && obj.shadow) {
            obj.shadow.mapSize.width = size;
            obj.shadow.mapSize.height = size;
            if (obj.shadow.map) {
              obj.shadow.map.dispose();
              obj.shadow.map = null;
            }
          }
        });
      }
      log(`Shadow quality: ${quality}`);
    });
  }

  log('Preview quality UI ready.');
}

function setupPropsUI() {
  const propsSelect = document.getElementById('props-select');
  const addPropBtn = document.getElementById('add-prop-btn');
  const deletePropBtn = document.getElementById('delete-prop-btn');
  const clearPropsBtn = document.getElementById('clear-props-btn');

  function populatePropsDropdown() {
    if (!propsSelect) return;
    propsSelect.innerHTML = '<option value="" disabled selected>--- Select a Prop ---</option>';
    
    const props = propManager.getAvailableProps();
    const categories = {};
    
    props.forEach(prop => {
      if (!categories[prop.category]) categories[prop.category] = [];
      categories[prop.category].push(prop);
    });
    
    Object.entries(categories).forEach(([category, items]) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = category;
      items.forEach(prop => {
        const option = document.createElement('option');
        option.value = prop.id;
        option.textContent = prop.name;
        optgroup.appendChild(option);
      });
      propsSelect.appendChild(optgroup);
    });
  }

  populatePropsDropdown();

  if (addPropBtn) {
    addPropBtn.addEventListener('click', async () => {
      const propId = propsSelect?.value;
      if (!propId) {
        log('Select a prop first', true);
        return;
      }
      // Spawn at the camera's look-at target so the prop appears
      // in the center of the viewport (where the main model is)
      const target = cameraManager.getControls().target;
      await propManager.addProp(propId, { x: target.x, y: target.y, z: target.z });
      propsSelect.value = '';
    });
  }

  if (deletePropBtn) {
    deletePropBtn.addEventListener('click', () => {
      if (propManager.selectedProp) {
        propManager.removeProp(propManager.selectedProp.id);
      } else {
        log('No prop selected', true);
      }
    });
  }

  if (clearPropsBtn) {
    clearPropsBtn.addEventListener('click', () => {
      if (confirm('Clear all props from scene?')) {
        propManager.clearAllProps();
      }
    });
  }

  log('Props UI ready.');
}

function setupSceneSetupUI() {
  const sceneSelect = document.getElementById('scene-select');
  const saveSceneBtn = document.getElementById('save-scene-btn');
  const exportSceneBtn = document.getElementById('export-scene-btn');
  const importSceneBtn = document.getElementById('import-scene-btn');
  const sceneFileInput = document.getElementById('scene-file-input');

  async function populateScenesDropdown() {
    if (!sceneSelect) return;
    sceneSelect.innerHTML = '<option value="" disabled selected>--- Select a Scene ---</option>';
    
    const customScenes = await sceneStorage.getAllSceneNames();
    
    if (customScenes.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = 'Custom Scenes';
      customScenes.forEach(name => {
        const option = document.createElement('option');
        option.value = `custom:${name}`;
        option.textContent = name;
        optgroup.appendChild(option);
      });
      sceneSelect.appendChild(optgroup);
    }
  }

  populateScenesDropdown();

  if (sceneSelect) {
    sceneSelect.addEventListener('change', async (e) => {
      const value = e.target.value;
      if (value.startsWith('custom:')) {
        const name = value.replace('custom:', '');
        const sceneData = await sceneStorage.getScene(name);
        if (sceneData) {
          await loadSceneSetup(sceneData);
          log(`Loaded scene: ${name}`);
        }
      }
    });
  }

  if (saveSceneBtn) {
    saveSceneBtn.addEventListener('click', async () => {
      const name = prompt('Enter scene name:');
      if (!name) return;
      
      const controls = cameraManager.getControls();
      const sceneData = {
        environment: {
          hdr: currentEnvironment,
          background: currentBackground
        },
        props: propManager.getSceneData(),
        camera: {
          position: {
            x: cameraManager.getCamera().position.x,
            y: cameraManager.getCamera().position.y,
            z: cameraManager.getCamera().position.z
          },
          target: {
            x: controls.target.x,
            y: controls.target.y,
            z: controls.target.z
          }
        },
        model: activeModel ? {
          name:     getCurrentModelName(),
          position: { x: activeModel.position.x, y: activeModel.position.y, z: activeModel.position.z },
          rotation: { x: activeModel.rotation.x, y: activeModel.rotation.y, z: activeModel.rotation.z },
          scale:    { x: activeModel.scale.x,    y: activeModel.scale.y,    z: activeModel.scale.z }
        } : null
      };
      
      await sceneStorage.saveScene(name, sceneData);
      await populateScenesDropdown();
      log(`Scene saved: ${name}`);
    });
  }

  if (exportSceneBtn) {
    exportSceneBtn.addEventListener('click', async () => {
      const value = sceneSelect?.value;
      if (!value || !value.startsWith('custom:')) {
        log('Select a custom scene to export', true);
        return;
      }
      const name = value.replace('custom:', '');
      await sceneStorage.exportScene(name);
      log(`Scene exported: ${name}`);
    });
  }

  if (importSceneBtn && sceneFileInput) {
    importSceneBtn.addEventListener('click', () => sceneFileInput.click());
    sceneFileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const result = await sceneStorage.importScene(file);
        if (result.success) {
          await populateScenesDropdown();
          log(`Scene imported: ${result.name}`);
        }
      } catch (err) {
        logError(`Import failed: ${err.message}`);
      }
      sceneFileInput.value = '';
    });
  }

  const clearScenesBtn = document.getElementById('clear-scenes-btn');
  if (clearScenesBtn) {
    clearScenesBtn.addEventListener('click', async () => {
      if (!confirm('Delete all custom scenes? This cannot be undone!')) return;
      const names = await sceneStorage.getAllSceneNames();
      await sceneStorage.clearAllScenes();
      await populateScenesDropdown();
      logSuccess(`Cleared ${names.length} custom scene(s)`);
    });
  }

  log('Scene setup UI ready.');
}

async function loadSceneSetup(sceneData) {
  if (sceneData.environment?.hdr) {
    loadScene(sceneData.environment.hdr, (_name, rawTexture) => {
      const envMap = createHDREnvironment(rawTexture);
      sceneManager.setEnvironment(envMap);
      sceneManager.getScene().background = rawTexture;
    });
  }
  if (sceneData.props) {
    await propManager.loadSceneData(sceneData.props);
  }

  // Camera restore must happen AFTER loadModel finishes, because loadModel calls
  // centerAndFrameModel() which resets the camera. Calling it here first would
  // get overwritten. Instead we use a helper and call it inside the onLoaded callback.
  function restoreCamera() {
    if (!sceneData.camera) return;
    cameraManager.getCamera().position.set(
      sceneData.camera.position.x,
      sceneData.camera.position.y,
      sceneData.camera.position.z
    );
    const orbitControls = cameraManager.getControls();
    orbitControls.target.set(
      sceneData.camera.target.x,
      sceneData.camera.target.y,
      sceneData.camera.target.z
    );
    orbitControls.update();
  }

  if (sceneData.model?.name) {
    // Sync the model dropdown so the UI reflects the saved model
    const modelSel = document.getElementById('object-select') || document.getElementById('model-select');
    if (modelSel) modelSel.value = sceneData.model.name;

    // Load the saved model; once it finishes, restore transform then camera
    // (camera must come after centerAndFrameModel so it isn't overwritten)
    loadModel(sceneData.model.name, () => {
      if (activeModel) {
        const m = sceneData.model;
        activeModel.position.set(m.position.x, m.position.y, m.position.z);
        activeModel.rotation.set(m.rotation.x, m.rotation.y, m.rotation.z);
        activeModel.scale.set(m.scale.x, m.scale.y, m.scale.z);
      }
      restoreCamera();
    });
  } else if (sceneData.model && activeModel) {
    // Legacy saves (no model name stored) — just restore transform on current model
    const m = sceneData.model;
    activeModel.position.set(m.position.x, m.position.y, m.position.z);
    activeModel.rotation.set(m.rotation.x, m.rotation.y, m.rotation.z);
    activeModel.scale.set(m.scale.x, m.scale.y, m.scale.z);
    restoreCamera();
  } else {
    restoreCamera();
  }
}

//═══════════════════════════════════════════════════════════════
// TRANSFORM TOOLBAR (viewport top-left)
//═══════════════════════════════════════════════════════════════

function setupTransformToolbar() {
  const btnTranslate = document.getElementById('tf-translate');
  const btnRotate    = document.getElementById('tf-rotate');
  const btnScale     = document.getElementById('tf-scale');
  const btnSnap      = document.getElementById('tf-snap');

  const modeBtns = [btnTranslate, btnRotate, btnScale];

  function activateMode(mode, btn) {
    modeBtns.forEach(b => b?.classList.remove('tf-btn--active'));
    btn?.classList.add('tf-btn--active');
    propManager.setTransformMode(mode);
  }

  btnTranslate?.addEventListener('click', () => activateMode('translate', btnTranslate));
  btnRotate?.addEventListener('click',    () => activateMode('rotate',    btnRotate));
  btnScale?.addEventListener('click',     () => activateMode('scale',     btnScale));

  // Snap toggle
  let snapOn = false;
  btnSnap?.addEventListener('click', () => {
    snapOn = !snapOn;
    propManager.setSnapEnabled(snapOn);
    btnSnap.classList.toggle('tf-btn--active', snapOn);
    log(`Snap: ${snapOn ? 'on' : 'off'}`);
  });

  // Keep toolbar in sync with keyboard shortcuts (G / R / S)
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key.toLowerCase()) {
      case 'g': activateMode('translate', btnTranslate); break;
      case 'r': activateMode('rotate',    btnRotate);    break;
      case 's':
        if (!e.ctrlKey && !e.metaKey) activateMode('scale', btnScale);
        break;
    }
  });
}

function animate() {
  requestAnimationFrame(animate);
  cameraManager.update();
  propManager.updateOutlines();
  rendererManager.render(sceneManager.getScene(), cameraManager.getCamera());
}
animate();

updateModelList();
updateSceneList();
updateMaterialPresetList();
setupCameraUI();
setupPostFXUI();
setupPreviewQualityUI();
setupPropsUI();
setupSceneSetupUI();
setupTransformToolbar();

rendererManager.getRenderer().toneMapping = THREE.ACESFilmicToneMapping;
rendererManager.getRenderer().toneMappingExposure = 1.0;

const firstModel = Object.keys(MODEL_PATHS).find(k => k !== 'BASE_PATH');
if (firstModel) {
  const name = firstModel.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  setTimeout(() => loadModel(name), 100);
}