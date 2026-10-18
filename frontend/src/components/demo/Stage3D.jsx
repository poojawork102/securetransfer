import { useRef, useEffect } from "react";
import * as THREE from "three";
import { COLORS } from "../../utils/constants";
import "./Stage3D.css";

const NODE_POSITIONS = {
  client: new THREE.Vector3(-3, 0, 0),
  network: new THREE.Vector3(0, 0, 0),
  server: new THREE.Vector3(3, 0, 0),
};

function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);

  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(0, 2, 6);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);
  const point = new THREE.PointLight(0x22d3ee, 0.8, 50);
  point.position.set(0, 4, 4);
  scene.add(point);

  const nodes = {};
  Object.entries(NODE_POSITIONS).forEach(([name, pos]) => {
    const geo = new THREE.SphereGeometry(0.35, 24, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.5,
      emissive: 0x22d3ee,
      emissiveIntensity: 0.15,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    scene.add(mesh);
    nodes[name] = mesh;
  });

  const linkGeo = new THREE.BufferGeometry().setFromPoints([
    NODE_POSITIONS.client,
    NODE_POSITIONS.network,
    NODE_POSITIONS.server,
  ]);
  const linkMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.3 });
  scene.add(new THREE.Line(linkGeo, linkMat));

  return { scene, camera, nodes };
}

export default function Stage3D({ chunks, running }) {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneDataRef = useRef(null);
  const packetsRef = useRef([]);
  const animRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const { scene, camera, nodes } = createScene();
    sceneDataRef.current = { scene, camera, nodes };

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let drift = 0;
    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      drift += 0.003;
      camera.position.x = Math.sin(drift) * 0.3;
      camera.position.y = 2 + Math.sin(drift * 0.5) * 0.2;
      camera.lookAt(0, 0, 0);

      packetsRef.current.forEach((pkt) => {
        if (pkt.t < 1) {
          pkt.t += 0.015;
          const t = Math.min(pkt.t, 1);
          pkt.mesh.position.lerpVectors(NODE_POSITIONS.client, NODE_POSITIONS.server, t);
          pkt.mesh.position.y = Math.sin(t * Math.PI) * 0.3;
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const { scene } = sceneDataRef.current || {};
    if (!scene) return;

    packetsRef.current.forEach((p) => {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    });

    const newPackets = chunks.slice(-30).map((chunk) => {
      const color = COLORS[chunk.status] || COLORS.travelling;
      const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      const t = chunk.status === "travelling" ? Math.random() * 0.8 : 1;
      mesh.position.lerpVectors(NODE_POSITIONS.client, NODE_POSITIONS.server, t);
      mesh.position.y = Math.sin(t * Math.PI) * 0.3;
      return { mesh, t, status: chunk.status };
    });
    packetsRef.current = newPackets;
  }, [chunks]);

  const idle = chunks.length === 0;

  return (
    <div className="stage3d card" ref={mountRef}>
      <div className="stage-labels">
        <span className="stage-label">Client</span>
        <span className="stage-label">Network</span>
        <span className="stage-label">Server</span>
      </div>
      {idle && (
        <div className="stage-idle">
          Press 1-4 or click an objective to start
        </div>
      )}
    </div>
  );
}
