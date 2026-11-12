import { useFrame, useThree } from '@react-three/fiber'
import { createWindTunnel, WIND_TUNNEL_CAMERA } from 'makio-meshline-wind-tunnel-example'
import { useEffect, useRef } from 'react'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export default function WindTunnel( { playing, reducedMotion, mode, wind, crosswind, onReady, onStatus, onError, onSceneLoad } ) {
	const { gl: renderer, scene, camera, size, invalidate } = useThree()
	const apiRef = useRef()
	const controlsRef = useRef()
	const current = useRef( { playing, reducedMotion, mode, wind, crosswind, size } )

	useEffect( () => {
		current.current = { playing, reducedMotion, mode, wind, crosswind, size }
		const api = apiRef.current
		if ( !api ) return
		api.setMode( mode )
		api.setWind( wind )
		api.setCrosswind( crosswind )
		api.setReducedMotion( reducedMotion )
		api.resize( size.width, size.height )
		invalidate()
	}, [playing, reducedMotion, mode, wind, crosswind, size, invalidate] )

	useEffect( () => {
		let cancelled = false
		const abortController = new AbortController()
		const controls = new OrbitControls( camera, renderer.domElement )
		controls.target.fromArray( WIND_TUNNEL_CAMERA.target )
		controls.minDistance = WIND_TUNNEL_CAMERA.minDistance
		controls.maxDistance = WIND_TUNNEL_CAMERA.maxDistance
		controls.minPolarAngle = WIND_TUNNEL_CAMERA.minPolarAngle
		controls.maxPolarAngle = WIND_TUNNEL_CAMERA.maxPolarAngle
		controls.autoRotateSpeed = 0.172
		controls.addEventListener( 'change', invalidate )
		controls.update()
		controlsRef.current = controls

		const pointerMove = event => {
			const bounds = renderer.domElement.getBoundingClientRect()
			apiRef.current?.setPointer(
				( event.clientX - bounds.left ) / bounds.width * 2 - 1,
				1 - ( event.clientY - bounds.top ) / bounds.height * 2,
			)
			invalidate()
		}
		renderer.domElement.addEventListener( 'pointermove', pointerMove )

		const loading = createWindTunnel( {
			renderer, scene, camera, canvas: renderer.domElement,
			signal: abortController.signal,
			reducedMotion: current.current.reducedMotion,
			quality: 'auto',
			onStatus: message => { if ( !cancelled ) onStatus( message ) },
		} ).then( api => {
			// Model loading can finish after a route change or an unmount.
			if ( cancelled ) {
				api.dispose()
				return
			}
			apiRef.current = api
			const props = current.current
			api.setMode( props.mode )
			api.setWind( props.wind )
			api.setCrosswind( props.crosswind )
			api.setReducedMotion( props.reducedMotion )
			api.resize( props.size.width, props.size.height )
			api.update( 0 )
			onReady()
			invalidate()
		} ).catch( error => { if ( !cancelled ) onError( error ) } )
		onSceneLoad( loading )

		return () => {
			cancelled = true
			abortController.abort()
			renderer.domElement.removeEventListener( 'pointermove', pointerMove )
			controls.removeEventListener( 'change', invalidate )
			controls.dispose()
			controlsRef.current = undefined
			apiRef.current?.dispose()
			apiRef.current = undefined
			// App releases the renderer after any pending scene load has cleaned up.
		}
	}, [renderer, scene, camera, invalidate, onReady, onStatus, onError, onSceneLoad] )

	useFrame( ( _, delta ) => {
		const api = apiRef.current
		if ( !api ) return
		try {
			const controls = controlsRef.current
			controls.autoRotate = playing && !reducedMotion
			controls.enableDamping = playing
			controls.update( delta )
			if ( playing ) api.update( delta )
			api.render()
		} catch ( error ) {
			onError( error )
		}
	}, 1 ) // Positive priority takes over R3F's render; the core renders its bloom pipeline once.

	return null
}
