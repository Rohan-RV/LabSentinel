import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { fmtFeature } from "../api";
import { SPECS } from "./twinSpecs";

function affectedSetOf(device) {
  const s = new Set();
  (device.top_factors || []).forEach((f) => { if (f.direction === "raises_risk") s.add(f.feature); });
  (device.envelope_breaches || []).forEach((b) => s.add(b.feature));
  return s;
}

function Twin3D({ device, spec, showLabels, exploded, selectedKey }) {
  const mountRef = useRef(null);
  const stt = useRef({ device, showLabels, exploded, selectedKey });
  stt.current = { device, showLabels, exploded, selectedKey };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let W = mount.clientWidth || 520;
    const H = 380;
    const PARTS = spec.parts;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#060a12");
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    const CAM_HOME = new THREE.Vector3(...spec.camHome);
    const TGT_HOME = new THREE.Vector3(...spec.tgtHome);
    camera.position.copy(CAM_HOME);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(W, H);
    labelRenderer.domElement.style.cssText = "position:absolute;top:0;left:0;pointer-events:none";
    mount.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.target.copy(TGT_HOME);
    controls.minDistance = 2.2; controls.maxDistance = 16;

    scene.add(new THREE.AmbientLight(0x9fbfff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(4, 6, 5); scene.add(dl);
    const pl = new THREE.PointLight(0x38d0ff, 0.7); pl.position.set(-4, 2, -3); scene.add(pl);
    const grid = new THREE.PolarGridHelper(3.2, 8, 6, 64, 0x1c4a5a, 0x123240); grid.position.y = -2.2; scene.add(grid);

    const steel = (c, m = 0.6, ro = 0.4) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: ro, transparent: true, opacity: 1 });
    const objects = {}, pickables = [], edges = {};
    function register(key, obj, pickMesh) {
      obj.userData.key = key; objects[key] = obj;
      (pickMesh ? [pickMesh] : obj.isGroup ? obj.children : [obj]).forEach((m) => { if (m.isMesh) { m.userData.key = key; pickables.push(m); } });
      const target = pickMesh || (obj.isGroup ? obj.children[0] : obj);
      if (target && target.geometry) {
        const eg = new THREE.LineSegments(new THREE.EdgesGeometry(target.geometry, 30), new THREE.LineBasicMaterial({ color: 0x2fd0e6, transparent: true, opacity: 0.32 }));
        target.add(eg); edges[key] = eg;
      }
    }
    spec.build({ THREE, scene, steel, register });

    const homes = {}, baseColor = {}, baseOpacity = {};
    PARTS.forEach((p) => {
      const o = objects[p.key]; if (!o) return;
      homes[p.key] = o.position.clone();
      const mm = o.isGroup ? o.children[0] : o;
      baseColor[p.key] = mm.material.color.clone(); baseOpacity[p.key] = mm.material.opacity;
    });

    const labels = {}, leaders = {};
    PARTS.forEach((p) => {
      const el = document.createElement("div");
      el.textContent = p.label;
      el.style.cssText = "padding:2px 7px;border:1px solid #2fd0e6;border-radius:6px;background:rgba(6,18,26,0.82);color:#8fe6f2;font:600 11px system-ui;white-space:nowrap;transform:translate(-50%,-50%)";
      const obj = new CSS2DObject(el); obj.position.set(...p.labelPos); scene.add(obj); labels[p.key] = obj;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p.anchor), new THREE.Vector3(...p.labelPos)]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x2fd0e6, transparent: true, opacity: 0.5 }));
      scene.add(line); leaders[p.key] = line;
    });

    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let hovered = null;
    function onMove(e) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      hovered = hit ? hit.object.userData.key : null;
      renderer.domElement.style.cursor = hovered ? "pointer" : "grab";
    }
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", () => { hovered = null; });

    let prevSel = "__init__", animT = 1;
    const camFrom = new THREE.Vector3(), camTo = new THREE.Vector3(), tgtFrom = new THREE.Vector3(), tgtTo = new THREE.Vector3();
    function startFocus(sel) {
      camFrom.copy(camera.position); tgtFrom.copy(controls.target);
      if (sel) { const p = PARTS.find((x) => x.key === sel); if (p) { const a = new THREE.Vector3(...p.anchor); tgtTo.copy(a); camTo.copy(a).add(new THREE.Vector3(...p.camOff)); } }
      else { camTo.copy(CAM_HOME); tgtTo.copy(TGT_HOME); }
      animT = 0;
    }

    let raf; const t0 = performance.now(); let expAmt = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      const now = performance.now(); const t = (now - t0) / 1000; const S = stt.current;
      const readings = (S.device && S.device.lastReading && S.device.lastReading.readings) || {};
      if (spec.spin) spec.spin({ objects, readings });

      const expTarget = S.exploded ? 1 : 0; expAmt += (expTarget - expAmt) * 0.12;
      PARTS.forEach((p) => { const off = new THREE.Vector3(...p.explode).multiplyScalar(expAmt); objects[p.key] && objects[p.key].position.copy(homes[p.key]).add(off); });

      if (S.selectedKey !== prevSel) { prevSel = S.selectedKey; startFocus(S.selectedKey); }
      if (animT < 1) {
        animT = Math.min(1, animT + (now - (animate._l || now)) / 900);
        const e = animT < 0.5 ? 2 * animT * animT : 1 - Math.pow(-2 * animT + 2, 2) / 2;
        camera.position.lerpVectors(camFrom, camTo, e); controls.target.lerpVectors(tgtFrom, tgtTo, e);
      }
      animate._l = now;

      const aff = affectedSetOf(S.device || {}); const pulse = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(t * 4));
      PARTS.forEach((p) => {
        const obj = objects[p.key]; if (!obj) return;
        const mesh = obj.isGroup ? obj.children[0] : obj; const mat = mesh.material;
        const fault = p.sensors.some((s) => aff.has(s)); const sel = S.selectedKey === p.key;
        if (fault) { mat.emissive.set(0xef4444); mat.emissiveIntensity = pulse; mat.color.set(0xd85a5a); }
        else if (sel) { mat.emissive.set(0x2fd0e6); mat.emissiveIntensity = 0.5; mat.color.copy(baseColor[p.key]); }
        else { mat.emissive.set(0x000000); mat.emissiveIntensity = 0; mat.color.copy(baseColor[p.key]); }
        const targetOp = hovered === p.key ? 0.12 : baseOpacity[p.key];
        mat.opacity += (targetOp - mat.opacity) * 0.25;
        if (edges[p.key]) edges[p.key].material.opacity = sel ? 0.9 : 0.3;
        labels[p.key].visible = S.showLabels; leaders[p.key].visible = S.showLabels;
        if (S.showLabels) { const pos = obj.position; const arr = leaders[p.key].geometry.attributes.position.array; arr[0] = pos.x; arr[1] = pos.y; arr[2] = pos.z; leaders[p.key].geometry.attributes.position.needsUpdate = true; }
      });

      controls.update(); renderer.render(scene, camera); labelRenderer.render(scene, camera);
    }
    animate();

    function onResize() { W = mount.clientWidth || 520; renderer.setSize(W, H); labelRenderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); }
    const ro = new ResizeObserver(onResize); ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose();
      renderer.domElement.removeEventListener("pointermove", onMove);
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (labelRenderer.domElement.parentNode) labelRenderer.domElement.parentNode.removeChild(labelRenderer.domElement);
    };
  }, [spec]);

  return <div ref={mountRef} style={{ position: "relative", width: "100%", height: 380, borderRadius: 12, overflow: "hidden" }} />;
}

const AVAILABLE = Object.keys(SPECS);

export default function Device3DPanel({ device }) {
  const [showLabels, setShowLabels] = useState(true);
  const [exploded, setExploded] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  useEffect(() => { setSelectedKey(null); setExploded(false); }, [device && device.id]);
  if (!device) return null;
  const spec = SPECS[device.type];
  if (!spec) {
    return (
      <div className="rounded-xl border border-ink-500/60 bg-ink-800/60 p-6 text-sm text-slate-400">
        Interactive 3D models are available for: <span className="text-slate-200 font-semibold">{AVAILABLE.join(", ")}</span>.
        Open one of those devices to explore it in 3D. The 2D model in the Digital Twin tab covers every device type, and the remaining 3D models are on the way.
      </div>
    );
  }
  const aff = affectedSetOf(device);
  const faults = spec.parts.filter((p) => p.sensors.some((s) => aff.has(s)));
  const sel = spec.parts.find((p) => p.key === selectedKey) || null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setExploded((v) => !v)} className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${exploded ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200" : "border-ink-500/60 text-slate-300 hover:bg-ink-600/50"}`}>
          {exploded ? "Reassemble" : "Split open (exploded view)"}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-300">
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="accent-cyan-400" />
          component labels
        </label>
        {selectedKey && (<button onClick={() => setSelectedKey(null)} className="rounded-md border border-ink-500/60 px-2.5 py-1 text-[11px] text-slate-400 hover:bg-ink-600/50">reset view</button>)}
      </div>

      <div className="rounded-xl border border-cyan-500/20 bg-[#060a12] p-1">
        <Twin3D device={device} spec={spec} showLabels={showLabels} exploded={exploded} selectedKey={selectedKey} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-sm font-medium ${faults.length ? "text-critical" : "text-healthy"}`}>
          {faults.length ? `Affected: ${faults.map((f) => f.label).join(", ")} (driven by ${[...aff].map(fmtFeature).join(", ")})` : "All components nominal"}
        </span>
        <span className="text-[11px] text-slate-500">hover a part to see through it, drag to rotate, scroll to zoom</span>
      </div>

      {sel && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm">
          <div className="mb-1 font-semibold text-cyan-200">{sel.label}</div>
          <div className="text-slate-300">{sel.desc}</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
        {spec.parts.map((p) => {
          const fault = p.sensors.some((s) => aff.has(s)); const active = selectedKey === p.key;
          return (
            <button key={p.key} onClick={() => setSelectedKey(active ? null : p.key)} className={`flex items-center gap-2 rounded px-1.5 py-1 text-left transition ${active ? "bg-cyan-500/15" : "hover:bg-ink-600/40"}`}>
              <span style={{ color: fault ? "#ef4444" : p.sensors.length ? "#22c55e" : "#64748b" }}>■</span>
              <span className={active ? "text-cyan-200" : "text-slate-300"}>{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
