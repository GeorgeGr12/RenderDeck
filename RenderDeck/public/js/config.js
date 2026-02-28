// CONFIG.JS - Centralized Configuration

export const CONFIG = {
  TEXTURE: {
    SIZE: 2048,
    COMPOSITE_SIZE: 2048,
    ENCODING: 'sRGBEncoding',
    ANISOTROPY: 16
  },
  MATERIALS: {
    WOOD:    { roughness: 0.7, metalness: 0.0 },
    METAL:   { roughness: 0.2, metalness: 1.0 },
    GLASS:   { roughness: 0.0, metalness: 0.0, opacity: 0.3, transparent: true },
    PLASTIC: { roughness: 0.3, metalness: 0.0 }
  },
  RENDERER: {
    ANTIALIAS: true,
    PIXEL_RATIO: Math.min(window.devicePixelRatio, 2),
    TONE_MAPPING_EXPOSURE: 1.0
  },
  CAMERA: {
    FOV: 50,
    NEAR: 0.1,
    FAR: 2000
  },
  SCENE: {
    CAMERA_FOV: 50,
    CAMERA_NEAR: 0.1,
    CAMERA_FAR: 2000,
    CAMERA_POSITION: { x: 0, y: 2, z: 5 },
    BACKGROUND_COLOR: 0x1a1a1a
  },
  CONTROLS: {
    DAMPING_ENABLED: true,
    DAMPING_FACTOR: 0.05
  },
  LIGHTING: {
    AMBIENT_INTENSITY: 0.4,
    AMBIENT_COLOR: 0xffffff,
    DIRECTIONAL_INTENSITY: 1.0,
    DIRECTIONAL_COLOR: 0xffffff,
    DIRECTIONAL_POSITION: { x: 5, y: 10, z: 7.5 },
    SHADOW_CAMERA_SIZE: 10,
    SHADOW_MAP_SIZE: 2048
  },
  POSTFX: {
    BLOOM_STRENGTH: 0.35,
    BLOOM_RADIUS: 0.2,
    BLOOM_THRESHOLD: 0.85
  }
};

export const FEATURES = {
  ENABLE_DEBUG_LOGGING: true
};

export const MODEL_PATHS = {
  BASE_PATH: 'models/',
  PLAIN_MUG: { folder: 'plain_mug', obj: 'mug.obj' },
  SIMPLE_PEN: { folder: 'simple_pen', obj: 'pen.obj', mtl: 'pen.mtl' }
};

export const PROP_PATHS = {
  BASE_PATH: 'props/',
  GLASS_WAITING_ROOM_TABLE: { file: 'glass_waiting_room_table.glb', category: 'Furniture', displayName: 'Glass Waiting Room Table' },
  LAPTOP: { file: 'laptop.glb', category: 'Electronics', displayName: 'Laptop' }
};

export const SCENE_PATHS = {
  BASE_PATH: 'scenes/',
  ENVIRONMENTS: {
    'Studio Kominka': 'studio_kominka_02_2k.hdr',
    'Lebombo': 'lebombo_2k.hdr'
  }
};

export const SCENE_SETUP_PATHS = {
  BASE_PATH: 'scenesetups/'
};

export const TRANSFORM_CONFIG = {
  SNAP_TRANSLATE: 0.25,
  SNAP_ROTATE: 15,
  SNAP_SCALE: 0.1,
  GIZMO_SIZE: 1
};