// 3D network stage: Client -> Proxy (channel) -> Server, with packets flying along a glowing link.
import * as THREE from "../vendor/three.module.min.js";

const COLORS = {
  client: 0x22d3ee, proxy: 0xfbbf24, server: 0x34d399,
  ok: 0x34d399, corrected: 0x60a5fa, crc_fail: 0xf87171, hmac_fail: 0xc084fc,
  corrupt: 0xf87171, forge: 0xe879f9, ack: 0x34d399, nack: 0xf87171,
};
const TRAVEL_MS = 900;

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class Stage {
  constructor(container, labels) {
    this.el = container;
    this.labels = labels; // {client, proxy, server} HTML elements
    this.packets = [];
    this.acks = [];
    this.bursts = [];
    this.proxyQ = new Map(); // seq -> [events in arrival order] (a retransmitted seq can be in flight twice)
    this.serverQ = new Map();
    this.mode = "clean";
    this.mouse = { x: 0, y: 0 };
    this.glow = glowTexture();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x070b14, 0.035);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(0, 4.2, 13);

    this.scene.add(new THREE.AmbientLight(0x8899ff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(4, 8, 6);
    this.scene.add(key);

    this._buildWorld();
    this._buildNodes();
    this._buildLink();

    addEventListener("resize", () => this.resize());
    container.addEventListener("pointermove", (e) => {
      const r = container.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    });
    this.resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  _sprite(color, scale) {
    const m = new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(scale);
    return s;
  }

  _buildWorld() {
    const grid = new THREE.GridHelper(60, 60, 0x1e3a5f, 0x0f1d33);
    grid.position.y = -1.6;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    this.scene.add(grid);

    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 30 - 4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80 - 10;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7dd3fc, size: 0.06, transparent: true,
      opacity: 0.7 }));
    this.scene.add(this.stars);
  }

  _buildNodes() {
    this.nodes = {};
    const mk = (name, x, mesh, color) => {
      const grp = new THREE.Group();
      grp.position.set(x, 0, 0);
      grp.add(mesh);
      const halo = this._sprite(color, 4.2);
      halo.material.opacity = 0.35;
      grp.add(halo);
      const light = new THREE.PointLight(color, 6, 7);
      grp.add(light);
      // pedestal ring
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.08, 64),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -1.55;
      grp.add(ring);
      this.scene.add(grp);
      this.nodes[name] = { grp, mesh, halo, light, ring, color, alive: false, pulse: 0, pulseColor: color };
    };

    // Client: wireframe icosahedron with solid core
    const client = new THREE.Group();
    client.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1),
      new THREE.MeshBasicMaterial({ color: COLORS.client, wireframe: true, transparent: true, opacity: 0.8 })));
    client.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0),
      new THREE.MeshStandardMaterial({ color: COLORS.client, emissive: COLORS.client, emissiveIntensity: 0.6,
        metalness: 0.3, roughness: 0.3 })));
    mk("client", -6, client, COLORS.client);

    // Proxy: octahedron core + two gyroscope rings
    const proxy = new THREE.Group();
    this.proxyCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0),
      new THREE.MeshStandardMaterial({ color: COLORS.proxy, emissive: COLORS.proxy, emissiveIntensity: 0.6,
        metalness: 0.5, roughness: 0.25, flatShading: true }));
    proxy.add(this.proxyCore);
    this.proxyRings = [0, 1].map((i) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.95 + i * 0.2, 0.025, 8, 80),
        new THREE.MeshBasicMaterial({ color: COLORS.proxy, transparent: true, opacity: 0.85 }));
      r.rotation.x = i ? Math.PI / 3 : -Math.PI / 4;
      proxy.add(r);
      return r;
    });
    mk("proxy", 0, proxy, COLORS.proxy);

    // Server: stacked rack blades with LED strips
    const server = new THREE.Group();
    this.serverLeds = [];
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.34, 1.0),
        new THREE.MeshStandardMaterial({ color: 0x0f2a24, metalness: 0.7, roughness: 0.35 }));
      blade.position.y = -0.62 + i * 0.42;
      server.add(blade);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.02),
        new THREE.MeshBasicMaterial({ color: COLORS.server }));
      led.position.set(0, blade.position.y, 0.51);
      server.add(led);
      this.serverLeds.push(led);
    }
    mk("server", 6, server, COLORS.server);
  }

  _buildLink() {
    this.path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-6, 0, 0), new THREE.Vector3(-3, 1.1, 0.4), new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(3, 1.1, -0.4), new THREE.Vector3(6, 0, 0),
    ]);
    this.linkMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22 });
    this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(this.path, 160, 0.035, 8, false), this.linkMat));
    // flowing dashes along the link
    const pts = this.path.getPoints(240);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    this.dashMat = new THREE.LineDashedMaterial({ color: 0x7dd3fc, dashSize: 0.18, gapSize: 0.32,
      transparent: true, opacity: 0.9 });
    this.dashLine = new THREE.Line(g, this.dashMat);
    this.dashLine.computeLineDistances();
    this.scene.add(this.dashLine);
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // pull the camera back on narrow screens so all three nodes fit
    this.camera.position.z = w < 700 ? 22 : 13;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- public API
  setAlive(name, alive) {
    const n = this.nodes[name];
    if (!n || n.alive === alive) return;
    n.alive = alive;
  }

  setMode(mode) {
    this.mode = mode;
    const c = mode === "attack" ? 0xe11d48 : mode === "noise" ? 0xfb923c : COLORS.proxy;
    const n = this.nodes.proxy;
    n.color = c;
    n.light.color.setHex(c);
    n.halo.material.color.setHex(c);
    n.ring.material.color.setHex(c);
    this.proxyCore.material.color.setHex(c);
    this.proxyCore.material.emissive.setHex(c);
    this.proxyRings.forEach((r) => r.material.color.setHex(c));
    this.linkMat.color.setHex(mode === "attack" ? 0xf43f5e : mode === "noise" ? 0xfb923c : 0x38bdf8);
  }

  sendPacket(seq, attempt = 1) {
    if (this.packets.length > 70) return; // keep it light
    const color = attempt > 1 ? 0xfbbf24 : COLORS.client;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, metalness: 0.2,
        roughness: 0.3 }));
    const halo = this._sprite(color, 0.9);
    mesh.add(halo);
    this.scene.add(mesh);
    this.packets.push({ seq, mesh, halo, t0: performance.now(), stage: 0, dead: false, spin: 0.02 });
  }

  // proxy did something to an in-flight packet: "corrupt" | "forge" | "drop" | "pass"
  _push(q, seq, v) { if (!q.has(seq)) q.set(seq, []); q.get(seq).push(v); }
  _shift(q, seq) { const a = q.get(seq); if (!a || !a.length) return undefined; const v = a.shift();
    if (!a.length) q.delete(seq); return v; }

  proxyEvent(seq, kind) { this._push(this.proxyQ, seq, kind); }

  serverResult(seq, status) { this._push(this.serverQ, seq, status); }

  reset() { this.proxyQ.clear(); this.serverQ.clear(); }

  ackPacket(ok) {
    if (this.acks.length > 40) return;
    const color = ok ? COLORS.ack : COLORS.nack;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), new THREE.MeshBasicMaterial({ color }));
    mesh.add(this._sprite(color, 0.6));
    this.scene.add(mesh);
    this.acks.push({ mesh, t0: performance.now() });
  }

  pulse(name, colorHex) {
    const n = this.nodes[name];
    n.pulse = 1;
    n.pulseColor = colorHex;
  }

  _burst(pos, color) {
    const n = 26, geo = new THREE.BufferGeometry(), p = new Float32Array(n * 3), v = [];
    for (let i = 0; i < n; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3);
      v.push(new THREE.Vector3((Math.random() - 0.5) * 0.12, Math.random() * 0.1, (Math.random() - 0.5) * 0.12));
    }
    geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.12, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(pts);
    this.bursts.push({ pts, v, life: 1 });
  }

  _dispose(obj) {
    this.scene.remove(obj);
    obj.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }

  // ---------------------------------------------------------------- frame loop
  _tick() {
    const now = performance.now(), dt = this.clock.getDelta(), t = this.clock.elapsedTime;

    // camera parallax + gentle sway
    const tx = this.mouse.x * 1.6 + Math.sin(t * 0.15) * 0.6, ty = 4.2 - this.mouse.y * 1.0;
    this.camera.position.x += (tx - this.camera.position.x) * 0.04;
    this.camera.position.y += (ty - this.camera.position.y) * 0.04;
    this.camera.lookAt(0, 0.2, 0);

    this.stars.rotation.y += dt * 0.01;
    this.dashMat.dashOffset = -t * 0.8;

    // nodes idle animation
    const { client, proxy, server } = this.nodes;
    client.mesh.rotation.y += dt * 0.6;
    client.mesh.rotation.x += dt * 0.2;
    client.grp.position.y = Math.sin(t * 1.4) * 0.12;
    const spin = this.mode === "attack" ? 3.2 : this.mode === "noise" ? 1.8 : 0.8;
    this.proxyRings[0].rotation.y += dt * spin;
    this.proxyRings[1].rotation.z += dt * spin * 0.8;
    this.proxyCore.rotation.y -= dt * spin * 0.6;
    if (this.mode === "noise") this.proxyCore.position.x = (Math.random() - 0.5) * 0.05;
    else this.proxyCore.position.x = 0;
    proxy.grp.position.y = Math.sin(t * 1.4 + 1) * 0.12;
    this.serverLeds.forEach((l, i) => { l.material.opacity = 1; l.scale.x = 0.6 + 0.4 * Math.abs(Math.sin(t * 2 + i)); });

    for (const n of Object.values(this.nodes)) {
      const base = n.alive ? 1 : 0.18;
      n.pulse = Math.max(0, n.pulse - dt * 2.2);
      n.halo.material.opacity = 0.25 * base + n.pulse * 0.7;
      n.halo.scale.setScalar(4.2 + n.pulse * 2.2);
      n.light.intensity = 4 * base + n.pulse * 18;
      if (n.pulse > 0) n.light.color.setHex(n.pulseColor);
      else n.light.color.setHex(n.color);
      n.mesh.traverse((o) => { if (o.material && "opacity" in o.material) { o.material.transparent = true;
        o.material.opacity = n.alive ? (o.material.wireframe ? 0.8 : 1) : 0.25; } });
      n.ring.rotation.z += dt * 0.3;
    }

    // packets
    for (const p of this.packets) {
      const u = Math.min(1, Math.max(0, (now - p.t0) / TRAVEL_MS));
      if (p.stage === 0 && u >= 0.5) {           // reached the proxy
        p.stage = 1;
        const kind = this._shift(this.proxyQ, p.seq);
        if (kind === "drop") { p.dead = true; this._burst(p.mesh.position, 0xfbbf24); continue; }
        if (kind === "corrupt" || kind === "forge") {
          const c = kind === "forge" ? COLORS.forge : COLORS.corrupt;
          p.mesh.material.color.setHex(c);
          p.mesh.material.emissive.setHex(c);
          p.halo.material.color.setHex(c);
          p.spin = 0.25;
          this.pulse("proxy", c);
          this._burst(p.mesh.position, c);
        }
      }
      if (u >= 1) {                               // reached the server
        const status = this._shift(this.serverQ, p.seq) || "ok";
        const c = COLORS[status] || COLORS.ok;
        this._burst(p.mesh.position, c);
        this.pulse("server", c);
        this.ackPacket(status === "ok" || status === "corrected");
        p.dead = true;
        continue;
      }
      const pos = this.path.getPointAt(u);
      p.mesh.position.copy(pos);
      p.mesh.rotation.x += p.spin;
      p.mesh.rotation.y += p.spin * 1.3;
    }
    this.packets = this.packets.filter((p) => { if (p.dead) this._dispose(p.mesh); return !p.dead; });

    // acks fly back on a lower path
    for (const a of this.acks) {
      const u = Math.min(1, Math.max(0, (now - a.t0) / (TRAVEL_MS * 0.8)));
      const pos = this.path.getPointAt(1 - u);
      a.mesh.position.set(pos.x, pos.y - 0.55 - Math.sin(u * Math.PI) * 0.4, pos.z + 0.5);
      if (u >= 1) { a.dead = true; this.pulse("client", a.mesh.material.color.getHex()); }
    }
    this.acks = this.acks.filter((a) => { if (a.dead) this._dispose(a.mesh); return !a.dead; });

    // particle bursts
    for (const b of this.bursts) {
      b.life -= dt * 1.4;
      const arr = b.pts.geometry.attributes.position.array;
      b.v.forEach((v, i) => { arr[i * 3] += v.x; arr[i * 3 + 1] += v.y; arr[i * 3 + 2] += v.z; v.y -= 0.004; });
      b.pts.geometry.attributes.position.needsUpdate = true;
      b.pts.material.opacity = Math.max(0, b.life);
    }
    this.bursts = this.bursts.filter((b) => { if (b.life <= 0) this._dispose(b.pts); return b.life > 0; });

    // HTML labels follow the nodes
    const r = this.el.getBoundingClientRect();
    for (const [name, n] of Object.entries(this.nodes)) {
      const v = n.grp.position.clone();
      v.y -= 2.0;
      v.project(this.camera);
      const el = this.labels[name];
      if (el) el.style.transform = `translate(${(v.x * 0.5 + 0.5) * r.width}px, ${(-v.y * 0.5 + 0.5) * r.height}px) translate(-50%, 0)`;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
