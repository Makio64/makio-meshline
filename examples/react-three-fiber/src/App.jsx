import { useRef, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { circlePositions } from 'makio-meshline'
import { MeshLine } from './MeshLine'

const circlePoints = circlePositions( 64, 3 )

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
	const ref = useRef()

	useFrame( ( _, dt ) => {
		if ( !ref.current ) return
		ref.current.rotation.z += dt * 0.3
	} )

	return (
		<group ref={ref}>
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

export default function App() {
	return (
		<Canvas
			camera={{ position: [0, 0, 10] }}
			gl={async ( props ) => {
				const renderer = new WebGPURenderer( { ...props, antialias: true } )
				await renderer.init()
				return renderer
			}}
		>
			<Controls />
			<RotatingCircle />
		</Canvas>
	)
}
