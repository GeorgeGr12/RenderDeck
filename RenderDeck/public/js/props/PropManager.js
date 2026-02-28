// PROPMANAGER.JS - Manages scene props (GLB models)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PROP_PATHS } from '../config.js';

export class PropManager {
  constructor(scene, camera, renderer, orbitControls, log) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.orbitControls = orbitControls;
    this.log = log || console.log;
    
    this.gltfLoader = new GLTFLoader();
    this.props = [];
    this.nextPropId = 1;
    this.selectedProp = null;
    this.transformControls = null;
    this.transformMode = 'translate';
    this.snapEnabled = false;
    this.collisionEnabled = false;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.customProps = new Map();
    
    this._setupTransformControls();
    this._setupEventListeners();
  }

  _setupTransformControls() {
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.transformMode);
    this.transformControls.setSize(1.5);
    // r155+: TransformControls is no longer an Object3D.
    // getHelper() returns the visual root that must be added to the scene.
    this._tcHelper = this.transformControls.getHelper();
    this.scene.add(this._tcHelper);
    
    this._gizmoWasActive = false;

    this.transformControls.addEventListener('dragging-changed', (event) => {
      if (this.orbitControls) {
        this.orbitControls.enabled = !event.value;
      }
      // When gizmo interaction ends, block the canvas click handler
      // from immediately deselecting the prop
      if (!event.value) {
        this._gizmoWasActive = true;
        requestAnimationFrame(() => { this._gizmoWasActive = false; });
      }
    });
    
    this.transformControls.addEventListener('objectChange', () => {
      if (this.selectedProp) {
        this._updatePropTransform(this.selectedProp);
      }
    });
  }

  _setupEventListeners() {
    this.renderer.domElement.addEventListener('click', (e) => this._onCanvasClick(e));
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
  }

  _onCanvasClick(event) {
    if (this.transformControls.dragging) return;
    if (this._gizmoWasActive) return;
    
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const propObjects = this.props.map(p => p.object3D).filter(Boolean);
    const allMeshes = [];
    propObjects.forEach(obj => {
      obj.traverse(child => {
        if (child.isMesh) allMeshes.push(child);
      });
    });
    
    const intersects = this.raycaster.intersectObjects(allMeshes, false);
    
    if (intersects.length > 0) {
      const hitMesh = intersects[0].object;
      const prop = this._findPropByMesh(hitMesh);
      if (prop) this.selectProp(prop.id);
    } else {
      this.deselectProp();
    }
  }

  _findPropByMesh(mesh) {
    for (const prop of this.props) {
      let found = false;
      prop.object3D?.traverse(child => {
        if (child === mesh) found = true;
      });
      if (found) return prop;
    }
    return null;
  }

  _onKeyDown(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    
    switch (event.key.toLowerCase()) {
      case 'g':
        this.setTransformMode('translate');
        break;
      case 'r':
        this.setTransformMode('rotate');
        break;
      case 's':
        if (!event.ctrlKey && !event.metaKey) this.setTransformMode('scale');
        break;
      case 'delete':
      case 'backspace':
        if (this.selectedProp) this.removeProp(this.selectedProp.id);
        break;
      case 'escape':
        this.deselectProp();
        break;
      case 'd':
        if ((event.ctrlKey || event.metaKey) && this.selectedProp) {
          event.preventDefault();
          this.duplicateProp(this.selectedProp.id);
        }
        break;
    }
  }

  getAvailableProps() {
    const props = [];
    
    Object.entries(PROP_PATHS).forEach(([key, cfg]) => {
      if (key !== 'BASE_PATH' && cfg.file) {
        props.push({
          id: key,
          name: cfg.displayName || key.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
          category: cfg.category || 'Uncategorized',
          type: 'builtin'
        });
      }
    });
    
    this.customProps.forEach((_url, name) => {
      props.push({ id: `custom_${name}`, name, category: 'Custom', type: 'custom' });
    });
    
    return props;
  }

  async addProp(propId, position = { x: 0, y: 0, z: 0 }) {
    let url, displayName;
    
    if (propId.startsWith('custom_')) {
      const name = propId.replace('custom_', '');
      url = this.customProps.get(name);
      displayName = name;
      if (!url) {
        this.log(`Custom prop not found: ${name}`, true);
        return null;
      }
    } else {
      const cfg = PROP_PATHS[propId];
      if (!cfg || !cfg.file) {
        this.log(`Prop not found: ${propId}`, true);
        return null;
      }
      url = PROP_PATHS.BASE_PATH + cfg.file;
      displayName = cfg.displayName || propId;
    }
    
    this.log(`Loading prop: ${displayName}...`);
    
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const object = gltf.scene;
          object.position.set(position.x, position.y, position.z);

          object.traverse(child => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // Auto-scale: normalize to ~1 unit so every prop is visible
          const box = new THREE.Box3().setFromObject(object);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const autoScale = maxDim > 0 ? 1.0 / maxDim : 1.0;
          object.scale.setScalar(autoScale);

          const prop = {
            id: `prop_${this.nextPropId++}`,
            type: propId,
            displayName,
            object3D: object,
            position: { ...position },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: autoScale, y: autoScale, z: autoScale },
            locked: false
          };

          this.scene.add(object);
          this.props.push(prop);
          // Update world matrix so TransformControls positions the gizmo correctly
          object.updateMatrixWorld(true);
          this.selectProp(prop.id);
          
          this.log(`Prop added: ${displayName}`);
          this._updatePropsList();
          resolve(prop);
        },
        undefined,
        (error) => {
          this.log(`Failed to load prop: ${error.message}`, true);
          reject(error);
        }
      );
    });
  }

  removeProp(propId) {
    const index = this.props.findIndex(p => p.id === propId);
    if (index === -1) return;
    
    const prop = this.props[index];
    if (this.selectedProp?.id === propId) this.deselectProp();
    
    this.scene.remove(prop.object3D);
    prop.object3D.traverse(child => {
      if (child.isMesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
    
    this.props.splice(index, 1);
    this.log(`Prop removed: ${prop.displayName}`);
    this._updatePropsList();
  }

  async duplicateProp(propId) {
    const prop = this.props.find(p => p.id === propId);
    if (!prop) return;
    
    const newPosition = {
      x: prop.position.x + 0.5,
      y: prop.position.y,
      z: prop.position.z + 0.5
    };
    
    const newProp = await this.addProp(prop.type, newPosition);
    if (newProp) {
      newProp.object3D.rotation.set(
        THREE.MathUtils.degToRad(prop.rotation.x),
        THREE.MathUtils.degToRad(prop.rotation.y),
        THREE.MathUtils.degToRad(prop.rotation.z)
      );
      newProp.object3D.scale.set(prop.scale.x, prop.scale.y, prop.scale.z);
      this._updatePropTransform(newProp);
    }
  }

  selectProp(propId) {
    const prop = this.props.find(p => p.id === propId);
    if (!prop || prop.locked) return;

    if (this.selectedProp) this._removeOutline(this.selectedProp);

    this.selectedProp = prop;
    this._addOutline(prop);
    this.transformControls.attach(prop.object3D);

    // --- DIAGNOSTIC: open F12 > Console to see this ---
    const wp = new THREE.Vector3();
    prop.object3D.getWorldPosition(wp);
    console.log(`[TC] attached to "${prop.displayName}" | world pos: ${wp.x.toFixed(3)}, ${wp.y.toFixed(3)}, ${wp.z.toFixed(3)} | TC visible: ${this.transformControls.visible} | TC in scene: ${this.transformControls.parent !== null}`);

    this._updatePropsList();
    this.log(`Selected: ${prop.displayName}`);
  }

  deselectProp() {
    if (this.selectedProp) {
      this._removeOutline(this.selectedProp);
      this.selectedProp = null;
    }
    this.transformControls.detach();
    this._updatePropsList();
  }

  _addOutline(prop) {
    const helper = new THREE.BoxHelper(prop.object3D, 0x00ff00);
    helper.userData.isOutline = true;
    this.scene.add(helper);
    prop._outlineHelper = helper;
  }

  _removeOutline(prop) {
    if (prop._outlineHelper) {
      this.scene.remove(prop._outlineHelper);
      prop._outlineHelper.geometry.dispose();
      prop._outlineHelper.material.dispose();
      prop._outlineHelper = null;
    }
  }

  _updatePropTransform(prop) {
    const p = prop.object3D.position;
    // Guard: TransformControls can produce NaN/Infinity at degenerate camera angles
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) {
      prop.object3D.position.set(prop.position.x, prop.position.y, prop.position.z);
      return;
    }
    prop.position.x = p.x;
    prop.position.y = p.y;
    prop.position.z = p.z;
    prop.rotation.x = THREE.MathUtils.radToDeg(prop.object3D.rotation.x);
    prop.rotation.y = THREE.MathUtils.radToDeg(prop.object3D.rotation.y);
    prop.rotation.z = THREE.MathUtils.radToDeg(prop.object3D.rotation.z);
    prop.scale.x = prop.object3D.scale.x;
    prop.scale.y = prop.object3D.scale.y;
    prop.scale.z = prop.object3D.scale.z;
    
    if (this.collisionEnabled) this._checkCollisions(prop);
    this._updatePropsList();
  }

  setTransformMode(mode) {
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    this.transformMode = mode;
    this.transformControls.setMode(mode);
    this.log(`Transform mode: ${mode}`);
  }

  setSnapEnabled(enabled) {
    this.snapEnabled = enabled;
    if (enabled) {
      this.transformControls.setTranslationSnap(0.25);
      this.transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
      this.transformControls.setScaleSnap(0.1);
    } else {
      this.transformControls.setTranslationSnap(null);
      this.transformControls.setRotationSnap(null);
      this.transformControls.setScaleSnap(null);
    }
  }

  setCollisionEnabled(enabled) {
    this.collisionEnabled = enabled;
  }

  _checkCollisions(prop) {
    const box1 = new THREE.Box3().setFromObject(prop.object3D);
    for (const other of this.props) {
      if (other.id === prop.id) continue;
      const box2 = new THREE.Box3().setFromObject(other.object3D);
      if (box1.intersectsBox(box2)) {
        this.log(`Collision: ${prop.displayName} <-> ${other.displayName}`);
      }
    }
  }

  async uploadCustomProp(file) {
    if (!file.name.endsWith('.glb') && !file.name.endsWith('.gltf')) {
      this.log('Only GLB/GLTF files are supported for props', true);
      return null;
    }
    const name = file.name.replace(/\.(glb|gltf)$/i, '');
    const url = URL.createObjectURL(file);
    this.customProps.set(name, url);
    this.log(`Custom prop uploaded: ${name}`);
    return `custom_${name}`;
  }

  clearAllProps() {
    while (this.props.length > 0) {
      this.removeProp(this.props[0].id);
    }
    this.log('All props cleared');
  }

  _updatePropsList() {
    const list = document.getElementById('props-list');
    if (!list) return;
    
    list.innerHTML = '';
    if (this.props.length === 0) {
      list.innerHTML = '<p class="empty-message">No props added</p>';
      return;
    }
    
    this.props.forEach(prop => {
      const item = document.createElement('div');
      item.className = 'prop-item' + (this.selectedProp?.id === prop.id ? ' selected' : '');
      item.dataset.propId = prop.id;
      
      const name = document.createElement('span');
      name.className = 'prop-item-name';
      name.textContent = prop.displayName;
      
      const coords = document.createElement('span');
      coords.className = 'prop-item-coords';
      coords.textContent = `(${prop.position.x.toFixed(1)}, ${prop.position.y.toFixed(1)}, ${prop.position.z.toFixed(1)})`;
      
      item.appendChild(name);
      item.appendChild(coords);
      item.addEventListener('click', () => this.selectProp(prop.id));
      list.appendChild(item);
    });
  }

  getSceneData() {
    return this.props.map(prop => ({
      type: prop.type,
      position: { ...prop.position },
      rotation: { ...prop.rotation },
      scale: { ...prop.scale }
    }));
  }

  async loadSceneData(propsData) {
    this.clearAllProps();
    for (const data of propsData) {
      const prop = await this.addProp(data.type, data.position);
      if (prop) {
        prop.object3D.rotation.set(
          THREE.MathUtils.degToRad(data.rotation.x),
          THREE.MathUtils.degToRad(data.rotation.y),
          THREE.MathUtils.degToRad(data.rotation.z)
        );
        prop.object3D.scale.set(data.scale.x, data.scale.y, data.scale.z);
        this._updatePropTransform(prop);
      }
    }
    this.deselectProp();
  }

  dispose() {
    this.clearAllProps();
    this.transformControls.dispose();
    this.scene.remove(this._tcHelper);
    this.customProps.forEach(url => URL.revokeObjectURL(url));
    this.customProps.clear();
  }
}