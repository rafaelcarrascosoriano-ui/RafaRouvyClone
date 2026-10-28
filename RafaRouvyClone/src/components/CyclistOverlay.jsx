import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';

function CyclistModel({ modelPath, cadence }) {
  const group = useRef();
  const { scene, animations } = useGLTF(modelPath);
  const { actions, names } = useAnimations(animations, group);

  useEffect(() => {
    if (names.length > 0) {
      const action = actions[names[0]];
      action.reset().fadeIn(0.5).play();
    }
  }, [actions, names, modelPath]);

  useFrame(() => {
    if (names.length > 0) {
      const action = actions[names[0]];
      if (action) {
        // La animación se acelera o se frena según tu cadencia real
        action.timeScale = cadence > 0 ? cadence / 90 : 0;
      }
    }
  });

  return <primitive ref={group} object={scene} scale={1.2} position={[0, -1.2, 0]} />;
}

export default function CyclistOverlay({ cadence = 0 }) {
  const [selectedModel, setSelectedModel] = useState('/models/cyclist.glb');

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}>
      {/* Selector de avatares en la esquina superior derecha */}
      <div style={{ position: 'absolute', top: '20px', right: '20px', pointerEvents: 'auto', zIndex: 20 }}>
        <select 
          value={selectedModel} 
          onChange={(e) => setSelectedModel(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '6px', background: '#222', color: '#fff', border: '1px solid #555', cursor: 'pointer' }}
        >
          <option value="/models/cyclist.glb">Modelo Principal</option>
        </select>
      </div>

      <Canvas camera={{ position: [0, 1.2, 3], fov: 45 }}>
        <ambientLight intensity={1.5} />
        <directionalLight position={[5, 10, 5]} intensity={2} />
        <CyclistModel modelPath={selectedModel} cadence={cadence} />
      </Canvas>
    </div>
  );
}
