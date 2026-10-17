import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { circlePositions } from 'makio-meshline'
import { useEffect, useRef } from 'react'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { WebGPURenderer } from 'three/webgpu'

import { MeshLine } from './MeshLine.jsx'

const circlePoints = circlePositions( 64, 3 )
const roadPoints = new Float32Array( [-4.5, -2.2, 0, -2.4, -1.55, 0, -0.5, -2.35, 0, 1.8, -1.45, 0, 4.5, -2.05, 0] )
const roadSurface = {
	frame: 'fixed-up',
	up: [0, 0, 1],
	uvMode: 'distance',
	uvScale: 2,
	roughness: 0.72,
	metalness: 0.12,
}
const roadJoin = { type: 'round', limit: 3, segments: 10 }
const roadCap = { type: 'round', segments: 10 }

async function createRenderer( props ) {
	const renderer = new WebGPURenderer( { ...props, antialias: true } )
	await renderer.init()
	return renderer
}

function Controls() {
	const { camera, gl } = useThree()
	const controlsRef = useRef()

	useEffect( () => {
		const controls = new OrbitControls( camera, gl.domElement )
		controls.enableDamping = true
		controlsRef.current = controls
		return () => controls.dispose()
	}, [camera, gl] )

	useFrame( () => controlsRef.current?.update() )

	return null
}

function RotatingCircle() {
	const groupRef = useRef()

	useFrame( ( _, dt ) => {
		if ( !groupRef.current ) return
		groupRef.current.rotation.z += dt * 0.3
	} )

	return (
		<group ref={groupRef} position={[0, 2, 0]}>
			<MeshLine
				points={circlePoints}
				closed
				lineWidth={0.2}
				color={0xff8800}
				gradientColor={0xffffff}
			/>
		</group>
	)
}

function RoadSurface() {
	return (
		<MeshLine
			points={roadPoints}
			surface={roadSurface}
			join={roadJoin}
			cap={roadCap}
			lineWidth={0.7}
			color={0x4aa8ff}
		/>
	)
}

export default function App() {
	return (
		<Canvas
			camera={{ position: [0, 0, 10] }}
			dpr={[1, 2]}
			gl={createRenderer}
		>
			<ambientLight intensity={0.9} />
			<directionalLight position={[4, 7, 8]} intensity={2.5} />
			<Controls />
			<RotatingCircle />
			<RoadSurface />
		</Canvas>
	)
}
