<script setup>
import { useLoop, useTres } from '@tresjs/core/webgpu'
import { createWindTunnel, WIND_TUNNEL_CAMERA } from 'makio-meshline-wind-tunnel-example'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { onBeforeUnmount, onMounted, watch } from 'vue'

const props = defineProps( {
	playing: Boolean,
	visible: Boolean,
	reducedMotion: Boolean,
	mode: { type: String, default: 'tunnel' },
	wind: { type: Number, default: 200 },
	crosswind: Boolean,
} )
const emit = defineEmits( ['ready', 'status', 'error'] )
const { scene, renderer, camera, sizes } = useTres()
const { onBeforeRender, onRender, render, start, stop, isActive } = useLoop()
const abortController = new AbortController()
let api
let controls
let disposed = false

function requestFrame() {
	if ( !disposed && api && props.visible && !isActive.value ) start()
}

function applySettings() {
	if ( !api ) return
	api.setMode( props.mode )
	api.setWind( props.wind )
	api.setCrosswind( props.crosswind )
	api.setReducedMotion( props.reducedMotion )
	api.resize( sizes.width.value, sizes.height.value )
	requestFrame()
}

function pointerMove( event ) {
	const bounds = renderer.domElement.getBoundingClientRect()
	api?.setPointer( ( event.clientX - bounds.left ) / bounds.width * 2 - 1, 1 - ( event.clientY - bounds.top ) / bounds.height * 2 )
	requestFrame()
}

// useLoop replaces Tres's default renderer, so only the core's bloom pipeline draws the scene.
render( notifySuccess => {
	try {
		if ( api && props.visible ) api.render()
	} catch ( error ) {
		stop()
		emit( 'error', error )
	} finally {
		notifySuccess()
	}
} )

onBeforeRender( ( { delta } ) => {
	if ( !api || !props.visible ) return
	try {
		controls.autoRotate = props.playing && !props.reducedMotion
		controls.enableDamping = props.playing
		controls.update( delta )
		if ( props.playing ) api.update( delta )
	} catch ( error ) {
		stop()
		emit( 'error', error )
	}
} )

onRender( () => {
	if ( !props.playing || !props.visible || !api ) stop()
} )

watch( [() => props.mode, () => props.wind, () => props.crosswind, () => props.reducedMotion, sizes.width, sizes.height], applySettings )
watch( [() => props.playing, () => props.visible], () => {
	if ( !props.visible ) stop()
	else requestFrame()
} )

onMounted( async () => {
	stop()
	if ( !renderer.backend.isWebGPUBackend ) {
		emit( 'error', new Error( 'The renderer selected WebGL2. Wind Tunnel requires native WebGPU compute.' ) )
		return
	}
	controls = new OrbitControls( camera.value, renderer.domElement )
	controls.target.fromArray( WIND_TUNNEL_CAMERA.target )
	controls.minDistance = WIND_TUNNEL_CAMERA.minDistance
	controls.maxDistance = WIND_TUNNEL_CAMERA.maxDistance
	controls.minPolarAngle = WIND_TUNNEL_CAMERA.minPolarAngle
	controls.maxPolarAngle = WIND_TUNNEL_CAMERA.maxPolarAngle
	controls.autoRotateSpeed = 0.172
	controls.addEventListener( 'change', requestFrame )
	controls.update()
	renderer.domElement.addEventListener( 'pointermove', pointerMove )
	try {
		const created = await createWindTunnel( {
			renderer, scene: scene.value, camera: camera.value, canvas: renderer.domElement,
			signal: abortController.signal,
			reducedMotion: props.reducedMotion,
			quality: 'auto',
			onStatus: message => { if ( !disposed ) emit( 'status', message ) },
		} )
		if ( disposed ) {
			created.dispose()
			return
		}
		api = created
		applySettings()
		api.update( 0 )
		emit( 'ready' )
		requestFrame()
	} catch ( error ) {
		if ( !disposed ) emit( 'error', error )
	}
} )

onBeforeUnmount( () => {
	disposed = true
	abortController.abort()
	stop()
	// Tres 5.10's render() replaces the callback and returns void.
	render( notifySuccess => notifySuccess() )
	renderer.domElement.removeEventListener( 'pointermove', pointerMove )
	controls?.removeEventListener( 'change', requestFrame )
	controls?.dispose()
	api?.dispose()
	api = undefined
	// TresCanvas owns and disposes its WebGPURenderer.
} )
</script>

<template>
	<slot />
</template>
