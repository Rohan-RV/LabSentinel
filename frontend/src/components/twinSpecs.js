import * as THREE from "three";

// Each device spec: part metadata (label, sensors, function, 3D layout) plus a
// build() that constructs the geometry and a spin() for the moving part. The
// generic Twin3D engine consumes this, so every device gets the same AR kit
// (hover see-through, exploded view, labels, fly-to legend, fault highlight).

const glass = (c, o) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.4, roughness: 0.5, transparent: true, opacity: o, side: THREE.DoubleSide });
const soft = (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.2, roughness: 0.6, transparent: true, opacity: 1 });

export const SPECS = {
  "Centrifuge": {
    camHome: [3.8, 2.8, 4.2], tgtHome: [0, -0.2, 0],
    parts: [
      { key: "rotor", label: "Rotor", sensors: ["rotational_speed"], desc: "Holds the sample tubes and spins them at high speed to separate contents by density.", anchor: [0, 0.05, 0], explode: [0, 1.0, 0], labelPos: [2.0, 0.7, 0.2], camOff: [1.7, 1.1, 1.9] },
      { key: "bearing", label: "Rotor bearing", sensors: ["tool_wear", "torque"], desc: "Carries the spinning load of the rotor. Wear shows up as vibration, heat and rising torque.", anchor: [0, -0.85, 0], explode: [0, -0.35, 0], labelPos: [-2.1, -0.3, 0.3], camOff: [1.6, 0.7, 1.7] },
      { key: "belt", label: "Drive belt", sensors: ["torque"], desc: "Transfers torque from the motor to the spindle. A slack or worn belt loses speed under load.", anchor: [0, -1.2, 0.33], explode: [0, -0.7, 0], labelPos: [-1.9, -1.0, 0.8], camOff: [1.5, 0.6, 1.7] },
      { key: "motor", label: "Drive motor", sensors: ["rotational_speed"], desc: "Provides the rotational power and drives the spindle through the belt.", anchor: [0, -1.7, 0], explode: [0, -1.0, 0], labelPos: [1.9, -1.6, 0.3], camOff: [1.7, 0.8, 1.8] },
      { key: "spindle", label: "Spindle", sensors: [], desc: "The central shaft that couples the motor and belt to the rotor.", anchor: [0, -0.35, 0], explode: [0, 0.3, 0], labelPos: [-2.1, 0.4, 0], camOff: [1.5, 0.8, 1.7] },
      { key: "housing", label: "Housing", sensors: [], desc: "The armored chamber that contains the rotor and absorbs energy if a tube fails.", anchor: [1.5, -0.35, 0], explode: [0, -0.5, 0], labelPos: [2.4, 0.1, 0], camOff: [2.3, 1.0, 2.5] },
      { key: "lid", label: "Lid", sensors: [], desc: "Seals the chamber during a spin and interlocks so it cannot open while spinning.", anchor: [0, 0.9, -0.4], explode: [0, 1.6, -0.5], labelPos: [0.5, 1.8, -0.2], camOff: [1.4, 1.4, 2.2] },
    ],
    build({ scene, steel, register }) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 2.05, 0.35, 48), steel(0x1c2636)); base.position.y = -1.9; scene.add(base);
      const hb = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.08, 48), steel(0x33414f)); hb.position.y = -0.95; scene.add(hb);
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.5, 1.2, 48, 1, true), glass(0x8a97a5, 1)); housing.position.y = -0.35; scene.add(housing); register("housing", housing);
      const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.95, 24), steel(0xb0bcc8)); spindle.position.y = -0.35; scene.add(spindle); register("spindle", spindle);
      const bearing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 16, 32), steel(0xc0ccd6)); bearing.rotation.x = Math.PI / 2; bearing.position.y = -0.85; scene.add(bearing); register("bearing", bearing);
      const rotor = new THREE.Group(); const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.05, 0.18, 40), steel(0xaeb9c4)); rotor.add(disc);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const t = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 16), steel(0x2c3a4a, 0.3, 0.6)); t.position.set(Math.cos(a) * 0.82, 0.02, Math.sin(a) * 0.82); t.rotation.z = Math.cos(a) * 0.5; t.rotation.x = Math.sin(a) * 0.5; rotor.add(t); }
      rotor.position.y = 0.05; scene.add(rotor); register("rotor", rotor, disc);
      const motor = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.75, 0.85), steel(0x54606e)); motor.position.y = -1.7; scene.add(motor); register("motor", motor);
      const belt = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.05, 12, 32), steel(0x2a2f35, 0.2, 0.8)); belt.rotation.x = Math.PI / 2; belt.position.y = -1.2; scene.add(belt); register("belt", belt);
      const lidP = new THREE.Group(); lidP.position.set(0, 0.3, -1.6); const lid = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.14, 48), glass(0x9fb0c0, 0.32)); lid.position.set(0, 0, 1.6); lidP.add(lid); lidP.rotation.x = -1.05; scene.add(lidP); register("lid", lidP, lid);
    },
    spin({ objects, readings }) { const rs = readings.rotational_speed; objects.rotor.rotation.y += rs ? Math.max(0.004, 0.02 * (rs / 2350)) : 0.02; },
  },

  "Ventilator": {
    camHome: [3.7, 2.4, 4.2], tgtHome: [0, 0, 0],
    parts: [
      { key: "blower", label: "Blower motor", sensors: ["rotational_speed", "torque"], desc: "Pushes air to the patient. A drop in speed or torque here is a power fault.", anchor: [-0.6, -0.1, 0], explode: [-1.7, 0.3, 0], labelPos: [-2.3, 0.9, 0], camOff: [1.6, 0.9, 1.8] },
      { key: "exchanger", label: "Heat exchanger", sensors: ["process_temperature"], desc: "Warms and conditions the delivered air. Over-temperature shows up here first.", anchor: [0.7, 0, 0], explode: [1.7, 0.3, 0], labelPos: [2.3, 0.7, 0], camOff: [1.6, 0.8, 1.7] },
      { key: "filter", label: "Air filter", sensors: [], desc: "Cleans intake air before it reaches the blower.", anchor: [-0.95, 0, -0.6], explode: [-1.2, -0.9, -1.1], labelPos: [-2.2, -0.9, -0.6], camOff: [1.4, 0.6, 1.6] },
      { key: "circuit", label: "Patient circuit", sensors: [], desc: "The tubing that carries conditioned air to and from the patient.", anchor: [0.9, -0.2, 0.8], explode: [0.7, -1.0, 1.6], labelPos: [1.9, -1.3, 1.2], camOff: [1.5, 0.6, 1.8] },
      { key: "enclosure", label: "Enclosure", sensors: [], desc: "The sealed housing that holds the gas path and electronics.", anchor: [0, 0, 0], explode: [0, 1.2, 0], labelPos: [0, 1.6, 0.8], camOff: [2.2, 1.2, 2.4] },
    ],
    build({ scene, steel, register }) {
      const enc = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.5), glass(0x8a97a5, 0.26)); scene.add(enc); register("enclosure", enc);
      const blower = new THREE.Group();
      const bh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.42, 32), steel(0x6b7684)); bh.rotation.x = Math.PI / 2; blower.add(bh);
      const fan = new THREE.Group();
      for (let i = 0; i < 6; i++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.12), steel(0xaeb9c4)); blade.position.y = 0.22; const h = new THREE.Group(); h.rotation.z = (i / 6) * Math.PI * 2; h.add(blade); fan.add(h); }
      fan.rotation.x = Math.PI / 2; blower.add(fan); blower.userData.fan = fan;
      blower.position.set(-0.6, -0.1, 0); scene.add(blower); register("blower", blower, bh);
      const ex = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.5), steel(0x7a8794)); ex.add(body);
      for (let i = 0; i < 6; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.05, 0.56), steel(0x9aa7b4)); fin.position.y = -0.3 + i * 0.12; ex.add(fin); }
      ex.position.set(0.7, 0, 0); scene.add(ex); register("exchanger", ex, body);
      const filter = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.95, 0.12), steel(0x54606e)); filter.position.set(-0.98, 0, -0.6); scene.add(filter); register("filter", filter);
      const circuit = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.09, 12, 24, Math.PI), soft(0x3a5a8a)); circuit.position.set(0.9, -0.2, 0.85); circuit.rotation.z = Math.PI / 2; scene.add(circuit); register("circuit", circuit);
    },
    spin({ objects, readings }) { const b = objects.blower; if (b && b.userData.fan) { const rs = readings.rotational_speed; b.userData.fan.rotation.y += rs ? Math.max(0.02, 0.06 * (rs / 1500)) : 0.05; } },
  },

  "MRI Scanner": {
    camHome: [4.4, 2.6, 4.8], tgtHome: [0, 0.3, 0],
    parts: [
      { key: "gradient", label: "Gradient coil", sensors: ["rotational_speed"], desc: "Generates the switching magnetic gradients used to form the image.", anchor: [0, 0, 0], explode: [0, 0, 1.6], labelPos: [2.0, 0.6, 0.8], camOff: [1.8, 0.9, 1.9] },
      { key: "coldhead", label: "Cold head", sensors: ["process_temperature"], desc: "Cryo cooler that keeps the superconducting magnet cold. Heat build-up shows here.", anchor: [0, 1.7, 0], explode: [0, 2.6, 0], labelPos: [1.3, 2.5, 0], camOff: [1.6, 0.9, 1.7] },
      { key: "aircool", label: "Air cooling", sensors: ["air_temperature"], desc: "Cabinet and room air cooling for the electronics and shell.", anchor: [0, 1.6, -0.9], explode: [-1.6, 2.2, -1.3], labelPos: [-2.1, 2.1, -0.9], camOff: [1.6, 0.9, 1.8] },
      { key: "table", label: "Patient table", sensors: [], desc: "Slides the patient into the bore for the scan.", anchor: [0, -0.55, 0.4], explode: [0, -1.3, 2.4], labelPos: [1.9, -1.3, 1.7], camOff: [1.7, 0.8, 2.0] },
      { key: "bore", label: "Scanner bore", sensors: [], desc: "The main magnet housing the patient passes through.", anchor: [0, 0, 0], explode: [0, 0, -0.6], labelPos: [-2.2, 0.4, -0.2], camOff: [2.6, 1.2, 2.8] },
    ],
    build({ scene, steel, register }) {
      const bore = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.62, 20, 48), glass(0x8a97a5, 0.5)); scene.add(bore); register("bore", bore);
      const gradient = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.13, 16, 48), steel(0x9fb6c4)); scene.add(gradient); register("gradient", gradient);
      const coldhead = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), steel(0x6b7684)); coldhead.position.set(0, 1.7, 0); scene.add(coldhead); register("coldhead", coldhead);
      const aircool = new THREE.Group(); const ab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), steel(0x54606e)); aircool.add(ab);
      const grille = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 20), steel(0xaeb9c4)); grille.rotation.x = Math.PI / 2; grille.position.z = 0.3; aircool.add(grille);
      aircool.position.set(0, 1.6, -0.9); scene.add(aircool); register("aircool", aircool, ab);
      const table = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 3.2), steel(0xb0bcc8)); table.position.set(0, -0.55, 0.4); scene.add(table); register("table", table);
    },
    spin({ objects, readings }) { const rs = readings.rotational_speed; objects.gradient.rotation.z += rs ? Math.max(0.003, 0.012 * (rs / 1600)) : 0.008; },
  },

  "Infusion Pump": {
    camHome: [3.4, 2.2, 4.0], tgtHome: [0, 0.2, 0],
    parts: [
      { key: "rotor", label: "Peristaltic rotor", sensors: ["rotational_speed"], desc: "Rollers squeeze the tube in waves to move fluid. Speed loss reduces flow rate.", anchor: [0, 0, 0.5], explode: [0, 0, 1.7], labelPos: [1.9, 0.7, 1.0], camOff: [1.5, 0.8, 1.7] },
      { key: "motor", label: "Drive motor", sensors: ["rotational_speed", "torque"], desc: "Turns the rotor. Torque or speed loss here stalls delivery.", anchor: [0, 0, -0.1], explode: [0, -1.2, -0.9], labelPos: [-2.0, -0.8, -0.4], camOff: [1.5, 0.7, 1.7] },
      { key: "bearing", label: "Occlusion bearing", sensors: ["torque"], desc: "Supports the rotor shaft and sets tube occlusion. Wear adds torque and jitter.", anchor: [0, 0, 0.25], explode: [0, -0.7, 0.7], labelPos: [-1.9, -0.3, 0.7], camOff: [1.4, 0.6, 1.6] },
      { key: "tube", label: "Delivery tube", sensors: [], desc: "The disposable line the rollers press against to move fluid.", anchor: [0, 0, 0.5], explode: [0, 0, 2.2], labelPos: [1.9, -0.4, 1.5], camOff: [1.5, 0.6, 1.8] },
      { key: "reservoir", label: "Reservoir", sensors: [], desc: "The fluid or drug bag feeding the pump.", anchor: [0, 1.2, 0], explode: [0, 2.3, 0], labelPos: [1.5, 2.2, 0], camOff: [1.5, 1.0, 1.8] },
      { key: "body", label: "Pump body", sensors: [], desc: "The housing and control unit of the pump.", anchor: [0, 0, 0], explode: [0, 1.1, 0], labelPos: [-1.9, 0.9, 0], camOff: [2.0, 1.0, 2.2] },
    ],
    build({ scene, steel, register }) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, 0.95), glass(0x8a97a5, 0.3)); scene.add(body); register("body", body);
      const rotor = new THREE.Group(); const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 28), steel(0x9fb6c4)); hub.rotation.x = Math.PI / 2; rotor.add(hub);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.34, 16), steel(0xc0ccd6)); roller.rotation.x = Math.PI / 2; roller.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0); rotor.add(roller); }
      rotor.position.set(0, 0, 0.5); scene.add(rotor); register("rotor", rotor, hub);
      const tube = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.06, 12, 40, Math.PI * 1.5), soft(0x3a5a8a)); tube.position.set(0, 0, 0.5); scene.add(tube); register("tube", tube);
      const motor = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.4), steel(0x54606e)); motor.position.set(0, 0, -0.1); scene.add(motor); register("motor", motor);
      const bearing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.05, 12, 24), steel(0xc0ccd6)); bearing.position.set(0, 0, 0.25); scene.add(bearing); register("bearing", bearing);
      const reservoir = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 16), glass(0x9fc0e0, 0.5)); reservoir.scale.set(1, 1.3, 0.55); reservoir.position.set(0, 1.2, 0); scene.add(reservoir); register("reservoir", reservoir);
    },
    spin({ objects, readings }) { const rs = readings.rotational_speed; objects.rotor.rotation.z += rs ? Math.max(0.006, 0.03 * (rs / 1450)) : 0.02; },
  },

  "ECG Machine": {
    camHome: [3.2, 2.0, 3.8], tgtHome: [0, 0, 0],
    parts: [
      { key: "board", label: "Signal board", sensors: ["process_temperature"], desc: "Amplifies and digitises the heart signal. Over-temperature shows up here first.", anchor: [0, 0, 0], explode: [0, 0, -1.4], labelPos: [-2.0, 0.6, -0.6], camOff: [1.4, 0.7, 1.6] },
      { key: "amplifier", label: "Front-end amplifier", sensors: [], desc: "Boosts the microvolt electrode signals before they are digitised.", anchor: [-0.5, -0.3, 0.1], explode: [-1.5, -0.6, 0.3], labelPos: [-2.1, -0.8, 0.2], camOff: [1.4, 0.6, 1.6] },
      { key: "screen", label: "Display", sensors: [], desc: "Shows the live ECG trace and vitals.", anchor: [0, 0.2, 0.31], explode: [0, 0.4, 1.5], labelPos: [1.9, 0.9, 0.6], camOff: [1.3, 0.7, 1.6] },
      { key: "leads", label: "Electrode leads", sensors: [], desc: "Pick up the electrical signal from the patient.", anchor: [0, -0.7, 0.4], explode: [0, -1.3, 1.4], labelPos: [1.8, -1.1, 0.8], camOff: [1.4, 0.6, 1.7] },
      { key: "enclosure", label: "Enclosure", sensors: [], desc: "The monitor housing and controls.", anchor: [0, 0, 0], explode: [0, 1.2, 0], labelPos: [0, 1.6, 0.6], camOff: [2.0, 1.0, 2.2] },
    ],
    build({ scene, steel, register }) {
      const enc = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, 0.6), glass(0x8a97a5, 0.26)); scene.add(enc); register("enclosure", enc);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.05), new THREE.MeshStandardMaterial({ color: 0x123a2a, metalness: 0.2, roughness: 0.4, transparent: true, opacity: 1 })); screen.position.set(0, 0.2, 0.31); scene.add(screen); register("screen", screen);
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.08), steel(0x2e6b4e)); scene.add(board); register("board", board);
      const amp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.2), steel(0x54606e)); amp.position.set(-0.5, -0.3, 0.1); scene.add(amp); register("amplifier", amp);
      const leads = new THREE.Group();
      for (let i = 0; i < 4; i++) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), soft(0x3a5a8a)); w.position.set(-0.3 + i * 0.2, -0.8, 0.35); w.rotation.x = 0.5; leads.add(w); }
      leads.position.set(0, 0.1, 0.05); scene.add(leads); register("leads", leads, leads.children[0]);
    },
  },

  "Spectrometer": {
    camHome: [3.7, 2.2, 4.2], tgtHome: [0, 0, 0],
    parts: [
      { key: "lamp", label: "Lamp source", sensors: ["air_temperature"], desc: "The light source. It runs hot, so cabinet air temperature tracks its health.", anchor: [-1.1, 0, 0], explode: [-2.0, 0.3, 0], labelPos: [-2.4, 0.7, 0], camOff: [1.4, 0.7, 1.6] },
      { key: "sample", label: "Sample cell", sensors: [], desc: "Holds the sample that the light beam passes through.", anchor: [-0.35, 0, 0], explode: [-0.4, 1.0, 0], labelPos: [-0.7, 1.3, 0.4], camOff: [1.2, 0.7, 1.4] },
      { key: "optics", label: "Optics", sensors: [], desc: "Prism or grating that splits the light into a spectrum.", anchor: [0.35, 0, 0], explode: [0.4, 1.0, 0], labelPos: [0.7, 1.3, 0.4], camOff: [1.2, 0.7, 1.4] },
      { key: "detector", label: "Detector", sensors: ["process_temperature"], desc: "Reads the split light. Over-temperature here degrades the readings.", anchor: [1.1, 0, 0], explode: [2.0, 0.3, 0], labelPos: [2.4, 0.7, 0], camOff: [1.4, 0.7, 1.6] },
      { key: "enclosure", label: "Enclosure", sensors: [], desc: "The light-tight optical bench housing.", anchor: [0, 0, 0], explode: [0, 1.3, 0], labelPos: [0, 1.7, 0.7], camOff: [2.4, 1.1, 2.5] },
    ],
    build({ scene, steel, register }) {
      const enc = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.0, 1.0), glass(0x8a97a5, 0.22)); scene.add(enc); register("enclosure", enc);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.3, 8), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffcf5a, emissiveIntensity: 0.5, transparent: true, opacity: 0.5 })); beam.rotation.z = Math.PI / 2; scene.add(beam);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 20), steel(0xd9c26a, 0.3, 0.5)); lamp.rotation.z = Math.PI / 2; lamp.position.set(-1.1, 0, 0); scene.add(lamp); register("lamp", lamp);
      const sample = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), glass(0x9fc0e0, 0.6)); sample.position.set(-0.35, 0, 0); scene.add(sample); register("sample", sample);
      const optics = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 4), steel(0xaeb9c4)); optics.rotation.x = Math.PI / 2; optics.position.set(0.35, 0, 0); scene.add(optics); register("optics", optics);
      const det = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), steel(0x54606e)); det.position.set(1.1, 0, 0); scene.add(det); register("detector", det);
    },
  },

  "PCR Thermocycler": {
    camHome: [3.3, 2.3, 3.9], tgtHome: [0, 0, 0],
    parts: [
      { key: "block", label: "Thermal block", sensors: ["process_temperature"], desc: "Heats and cools the sample wells in cycles. Over-temperature shows here.", anchor: [0, 0.1, 0], explode: [0, 0.6, 0], labelPos: [2.0, 0.6, 0], camOff: [1.5, 0.8, 1.6] },
      { key: "heater", label: "Heating element", sensors: ["air_temperature", "tool_wear"], desc: "Drives the block temperature. Wear and cabinet heat track its condition.", anchor: [0, -0.35, 0], explode: [0, -1.2, 0], labelPos: [-2.0, -0.8, 0], camOff: [1.5, 0.7, 1.6] },
      { key: "lid", label: "Heated lid", sensors: [], desc: "Presses on the tubes and prevents condensation during cycling.", anchor: [0, 0.6, 0], explode: [0, 1.7, 0], labelPos: [0, 2.0, 0.5], camOff: [1.4, 1.0, 1.7] },
      { key: "controller", label: "Controller", sensors: [], desc: "Runs the temperature program and ramps.", anchor: [0, -0.2, -0.6], explode: [0, -0.4, -1.5], labelPos: [-1.9, -0.2, -0.6], camOff: [1.4, 0.7, 1.7] },
      { key: "enclosure", label: "Enclosure", sensors: [], desc: "The instrument housing.", anchor: [0, 0, 0], explode: [0, 0, 1.4], labelPos: [1.9, -0.5, 0.8], camOff: [2.1, 1.0, 2.3] },
    ],
    build({ scene, steel, register }) {
      const enc = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 1.4), glass(0x8a97a5, 0.24)); scene.add(enc); register("enclosure", enc);
      const block = new THREE.Group(); const bb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.9), steel(0x7a8794)); block.add(bb);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const well = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), steel(0x2c3a4a)); well.position.set(-0.4 + i * 0.27, 0.2, -0.3 + j * 0.3); block.add(well); }
      block.position.set(0, 0.1, 0); scene.add(block); register("block", block, bb);
      const heater = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.9), steel(0x9a6a4a, 0.3, 0.6)); heater.position.set(0, -0.35, 0); scene.add(heater); register("heater", heater);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 1.0), glass(0x9fb0c0, 0.4)); lid.position.set(0, 0.6, 0); scene.add(lid); register("lid", lid);
      const ctrl = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.2), steel(0x54606e)); ctrl.position.set(0, -0.2, -0.6); scene.add(ctrl); register("controller", ctrl);
    },
  },

  "HPLC Chromatograph": {
    camHome: [3.7, 2.8, 4.3], tgtHome: [0, 0.2, 0],
    parts: [
      { key: "pump", label: "Solvent pump", sensors: ["rotational_speed", "torque"], desc: "Pushes solvent at high pressure. Loss of speed or torque is a power fault.", anchor: [0, -0.6, 0], explode: [-1.7, -0.6, 0], labelPos: [-2.2, -0.3, 0], camOff: [1.5, 0.7, 1.7] },
      { key: "column", label: "Column heater", sensors: ["process_temperature"], desc: "Holds the separation column at temperature. Over-temperature shows here.", anchor: [0, 0.1, 0], explode: [1.7, 0.1, 0], labelPos: [2.3, 0.4, 0], camOff: [1.5, 0.8, 1.7] },
      { key: "detector", label: "Detector", sensors: [], desc: "Measures the separated compounds as they elute from the column.", anchor: [0, 0.8, 0], explode: [0, 1.9, 0], labelPos: [1.9, 1.5, 0], camOff: [1.4, 0.9, 1.7] },
      { key: "injector", label: "Injector", sensors: [], desc: "Introduces the sample into the solvent stream.", anchor: [0, -0.6, 0.5], explode: [0, -1.4, 1.4], labelPos: [1.8, -1.1, 0.8], camOff: [1.4, 0.7, 1.7] },
      { key: "reservoir", label: "Solvent reservoir", sensors: [], desc: "Bottles of mobile-phase solvent feeding the pump.", anchor: [-0.5, 1.4, 0], explode: [-1.5, 2.5, 0], labelPos: [-2.1, 2.2, 0], camOff: [1.5, 1.1, 1.8] },
      { key: "stack", label: "Chassis", sensors: [], desc: "The modular instrument stack that holds the modules.", anchor: [0, 0, 0], explode: [0, 0, -1.3], labelPos: [-2.1, 0.8, -0.6], camOff: [2.3, 1.2, 2.5] },
    ],
    build({ scene, steel, register }) {
      const stack = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.1, 1.0), glass(0x8a97a5, 0.2)); scene.add(stack); register("stack", stack);
      const pump = new THREE.Group(); const pb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.8), steel(0x6b7684)); pump.add(pb);
      const prot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 20), steel(0xc0ccd6)); prot.rotation.x = Math.PI / 2; prot.position.set(0.4, 0, 0.45); pump.add(prot); pump.userData.rot = prot;
      pump.position.set(0, -0.6, 0); scene.add(pump); register("pump", pump, pb);
      const column = new THREE.Group(); const cb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.8), steel(0x7a8794)); column.add(cb);
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 10, 32), soft(0xaeb9c4)); coil.position.set(0.35, 0, 0.45); column.add(coil);
      column.position.set(0, 0.1, 0); scene.add(column); register("column", column, cb);
      const det = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.8), steel(0x54606e)); det.position.set(0, 0.8, 0); scene.add(det); register("detector", det);
      const inj = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), steel(0x9fb6c4)); inj.position.set(0, -0.6, 0.5); scene.add(inj); register("injector", inj);
      const res = new THREE.Group();
      for (let i = 0; i < 2; i++) { const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 16), glass(0x9fc0e0, 0.5)); bottle.position.set(-0.25 + i * 0.5, 0, 0); res.add(bottle); }
      res.position.set(-0.5, 1.4, 0); scene.add(res); register("reservoir", res, res.children[0]);
    },
    spin({ objects, readings }) { const p = objects.pump; if (p && p.userData.rot) { const rs = readings.rotational_speed; p.userData.rot.rotation.z += rs ? Math.max(0.006, 0.03 * (rs / 1700)) : 0.02; } },
  },
};
