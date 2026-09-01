import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Agent {
  constructor(id, name, type, scene, bounds, startPos, modelUrl, 
              scale = 1, rotation = 0, hitboxScale = 1,
              speedScale = 1) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.scene = scene;
    this.bounds = bounds;
    this.baseScale = scale;
    
    this.hitboxRadius = 1.0 * hitboxScale;
    
    this.maxSpeed = (type === 'drone' ? 0.15 : 0.04) * speedScale;
    this.acceleration = 0.006 * speedScale;
    this.braking = 0.05 * speedScale;
    
    this.position = startPos.clone();
    this.velocity = new THREE.Vector3();
    this.target = null;
    this.state = 'roaming';
    this.idleTimer = 0;
    
    this.mesh = new THREE.Group();
    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);
    
    this.loadModel(modelUrl, scale, rotation);

    this.labelSprite = this.createTextLabel(this.name);
    this.labelSprite.position.set(0, 2.5, 0); 
    this.labelSprite.visible = false;
    this.mesh.add(this.labelSprite);
    
    this.particles = [];
    this.particleGroup = new THREE.Group();
    this.scene.add(this.particleGroup);
    
    this.pickNewTarget();
  }

  loadModel(url, scale, rotation) {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      const model = gltf.scene;
      model.scale.setScalar(scale);
      model.rotation.y = rotation;

      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      this.mesh.add(model);
    }, undefined, (error) => {
      console.error('Error loading model:', error);
      const fallback = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshLambertMaterial({color: 0xff0000}));
      this.mesh.add(fallback);
    });
  }

  createTextLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'; 
    ctx.roundRect(0, 0, 256, 64, 16);
    ctx.fill();

    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#fbbf24'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false }); 
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3, 0.75, 1); 
    return sprite;
  }

  setHoverState(isHovered) {
    this.labelSprite.visible = isHovered;
  }

  pickNewTarget() {
    this.target = new THREE.Vector3(
      THREE.MathUtils.randFloat(this.bounds.xMin + 2, this.bounds.xMax - 2),
      this.type === 'drone' ? THREE.MathUtils.randFloat(2.0, 3.5) : 0,
      THREE.MathUtils.randFloat(this.bounds.zMin + 2, this.bounds.zMax - 2)
    );
  }

  // Updated to accept allAgents array
  update(obstacles, allAgents, time) {
    if (this.state === 'idle') {
      this.idleTimer -= 0.016; 
      
      if (this.type === 'segway') {
        this.mesh.rotation.x = Math.sin(time * 10) * 0.03;
      } else if (this.type === 'drone') {
        this.mesh.position.y = this.position.y + Math.sin(time * 3) * 0.1;
      }
      
      if (this.idleTimer <= 0) {
        this.state = 'roaming';
        this.pickNewTarget();
      }
      
      this.velocity.multiplyScalar(0.9);
      this.mesh.position.add(this.velocity);
      return;
    }

    let steeringForce = new THREE.Vector3();
    
    // 1. Seek target
    const desiredVelocity = new THREE.Vector3().subVectors(this.target, this.mesh.position);
    const distanceToTarget = desiredVelocity.length();
    
    if (distanceToTarget < 1.0) {
      if (Math.random() < 0.4) {
        this.state = 'idle';
        this.idleTimer = THREE.MathUtils.randFloat(1.5, 4.0); 
        return;
      } else {
        this.pickNewTarget();
      }
    }

    desiredVelocity.normalize().multiplyScalar(this.maxSpeed);
    steeringForce.subVectors(desiredVelocity, this.velocity);
    steeringForce.clampLength(0, this.acceleration);
    this.velocity.add(steeringForce);

    // 2. Obstacle Interaction (Stop on bump)
    obstacles.forEach(obs => {
      const dist = this.mesh.position.distanceTo(obs.position);
      const hitRadius = obs.radius + this.hitboxRadius; 
      if (dist < hitRadius + 0.5) { // If touching or very close
        this.state = 'idle';
        this.idleTimer = THREE.MathUtils.randFloat(2.0, 5.0);
        this.velocity.set(0, 0, 0); // Stop moving immediately
        this.pickNewTarget(); // Pick a new target for when it wakes up
      }
    });

    // 3. Agent-to-Agent Soft Resistance
    allAgents.forEach(other => {
      if (other.id === this.id) return;
      
      const dist = this.mesh.position.distanceTo(other.mesh.position);
      const minSafeDist = this.hitboxRadius + other.hitboxRadius;
      
      if (dist < minSafeDist) {
        const overlap = minSafeDist - dist;
        const pushForce = new THREE.Vector3().subVectors(this.mesh.position, other.mesh.position);
        pushForce.y = 0; 
        pushForce.normalize().multiplyScalar(overlap * 0.05); // Soft spring factor
        
        // Push myself away
        this.velocity.add(pushForce);
        
        // If the other agent is idle, push them physically so they slide
        if (other.state === 'idle') {
          other.velocity.sub(pushForce.clone().multiplyScalar(0.8));
        }
      }
    });

    // 4. Boundary Reinforcement
    if (this.mesh.position.x < this.bounds.xMin + 1) this.velocity.x += this.braking;
    if (this.mesh.position.x > this.bounds.xMax - 1) this.velocity.x -= this.braking;
    if (this.mesh.position.z < this.bounds.zMin + 1) this.velocity.z += this.braking;
    if (this.mesh.position.z > this.bounds.zMax - 1) this.velocity.z -= this.braking;

    this.velocity.clampLength(0, this.maxSpeed);
    this.mesh.position.add(this.velocity);

    if (this.velocity.lengthSq() > 0.001) {
      const targetRotationY = Math.atan2(this.velocity.x, this.velocity.z);
      
      let diff = targetRotationY - this.mesh.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.mesh.rotation.y += diff * 0.1;

      const currentSpeed = this.velocity.length();

      if (this.type === 'car') {
        this.mesh.rotation.z = -diff * 0.03;
        this.mesh.rotation.x = 0;
      } else if (this.type === 'segway') {
        this.mesh.rotation.x = currentSpeed * 2.0; 
        this.mesh.rotation.z = 0;
      } else if (this.type === 'drone') {
        this.mesh.rotation.x = currentSpeed * 1.5;
        this.mesh.rotation.z = -diff * 0.6;
        this.mesh.position.y += Math.sin(time * 5) * 0.02;
      }

      if (Math.random() < 0.3) {
        this.emitParticle();
      }
    }

    this.updateParticles();
  }

  // ... (emitParticle, updateParticles, destroy remain unchanged)
  emitParticle() {
    const pGeo = new THREE.BoxGeometry(0.1, 0.02, 0.1);
    const pMat = new THREE.MeshBasicMaterial({ 
      color: this.type === 'drone' ? 0xc084fc : 0xd1d5db, 
      transparent: true, 
      opacity: 0.6 
    });
    const pMesh = new THREE.Mesh(pGeo, pMat);
    
    pMesh.position.set(
      this.mesh.position.x + THREE.MathUtils.randFloat(-0.2, 0.2),
      this.type === 'drone' ? 0.01 : this.mesh.position.y - 0.2,
      this.mesh.position.z + THREE.MathUtils.randFloat(-0.2, 0.2)
    );
    
    this.particleGroup.add(pMesh);
    this.particles.push({ mesh: pMesh, age: 0, maxAge: 30 });
  }

  updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age++;
      p.mesh.material.opacity = 1 - (p.age / p.maxAge);
      p.mesh.scale.multiplyScalar(0.96);
      
      if (p.age >= p.maxAge) {
        this.particleGroup.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  destroy() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.particleGroup);
  }
}