import { MeshLine } from 'makio-meshline'
import { Group, MathUtils } from 'three/webgpu'

import { isMobile, loadWindTunnelCar } from './car.js'
import { createEnvironment } from './environment.js'
import { WindTunnelFlow } from './flow.js'

const RADIUS = 8.2
const THETA = 0.95
const PHI = 1.41

export const WIND_TUNNEL_CAMERA = Object.freeze( {
	fov: 32,
	near: 0.1,
	far: 160,
	target: [0, 0.6, -0.4],
	position: [
		RADIUS * Math.sin( PHI ) * Math.cos( THETA ),
		0.6 + RADIUS * Math.cos( PHI ),
		-0.4 + RADIUS * Math.sin( PHI ) * Math.sin( THETA ),
	],
	minDistance: 4.5,
	maxDistance: 18,
	minPolarAngle: 0.35,
	maxPolarAngle: 1.5,
} )

/**
 * Create the complete Wind Tunnel inside an initialized native-WebGPU host.
 * The caller owns the renderer, camera, render loop, events, and UI.
 */
export async function createWindTunnel( {
	renderer,
	scene,
	camera,
	canvas = renderer?.domElement,
	modelUrl = `${import.meta.env?.BASE_URL ?? './'}models/hover-car.glb`,
	reducedMotion = false,
	quality = 'auto',
	onStatus = () => {},
	signal,
} ) {
	function throwIfAborted() {
		if ( signal?.aborted ) throw new DOMException( 'Wind Tunnel setup was canceled.', 'AbortError' )
	}
	throwIfAborted()
	if ( !renderer?.backend?.isWebGPUBackend ) {
		throw new Error( 'Wind Tunnel requires native WebGPU for its compute simulation. Ordinary Makio MeshLine rendering also supports WebGL2.' )
	}
	if ( !scene?.isScene || !camera?.isCamera ) throw new TypeError( 'Pass a Three.js Scene and Camera to createWindTunnel().' )

	const mobile = quality === 'low' || ( quality === 'auto' && isMobile )
	const resources = new Set()
	const own = resource => {
		if ( resource ) resources.add( resource )
		return resource
	}
	const previous = {
		background: scene.background,
		backgroundNode: scene.backgroundNode,
		environment: scene.environment,
		toneMapping: renderer.toneMapping,
	}
	const content = new Group()
	content.name = 'Makio MeshLine Wind Tunnel'
	scene.add( content )
	let disposed = false

	function dispose() {
		if ( disposed ) return
		disposed = true
		content.removeFromParent()
		content.traverse( object => {
			if ( object instanceof MeshLine ) {
				own( object )
				return
			}
			own( object.geometry )
			for ( const material of [object.material].flat() ) {
				if ( !material ) continue
				for ( const value of Object.values( material ) ) {
					if ( value?.isTexture ) own( value )
				}
				own( material )
			}
		} )
		for ( const resource of [...resources].reverse() ) {
			if ( resource.isBufferAttribute ) renderer._attributes?.delete?.( resource )
			resource.dispose?.()
		}
		resources.clear()
		scene.background = previous.background
		scene.backgroundNode = previous.backgroundNode
		scene.environment = previous.environment
		renderer.toneMapping = previous.toneMapping
	}

	try {
		onStatus( 'Loading the authored hover car…' )
		const { carRoot, sdfBuffer } = await loadWindTunnelCar( {
			modelUrl,
			own,
			onLoad( car ) {
				content.add( car )
				throwIfAborted()
				onStatus( 'Building the car’s flow field…' )
			},
		} )
		own( sdfBuffer )
		throwIfAborted()
		onStatus( 'Preparing smoke, reflections, and bloom…' )
		throwIfAborted()
		const environment = createEnvironment( { renderer, scene, camera, carRoot, own, mobile } )
		content.add( environment.group )
		const flow = new WindTunnelFlow( { renderer, content, own, sdfBuffer, rakeBar: environment.rakeBar, reducedMotion } )
		const settings = { mode: 'tunnel', wind: 200, crosswind: false }

		const api = {
			settings,
			update( dtSeconds ) {
				if ( disposed ) return
				// A returning tab cannot accumulate an unbounded compute backlog.
				const dt = MathUtils.clamp( dtSeconds, 0, 0.05 )
				if ( dt > 0 ) flow.update( dt )
				environment.update()
			},
			render() {
				if ( !disposed ) environment.render()
			},
			resize( width, height ) {
				content.traverse( object => {
					if ( object instanceof MeshLine ) object.resize( width, height )
				} )
			},
			setMode( mode ) {
				const index = ['tunnel', 'rake', 'ground'].indexOf( mode )
				if ( index < 0 ) throw new RangeError( `Unknown Wind Tunnel mode: ${mode}` )
				settings.mode = mode
				flow.uMode.value = index
				environment.rakeBar.visible = mode === 'rake'
			},
			setWind( kmH ) {
				if ( !Number.isFinite( kmH ) ) throw new TypeError( 'Wind speed must be a finite number in km/h.' )
				settings.wind = MathUtils.clamp( kmH, 80, 500 )
				flow.targetWind = settings.wind / 200
			},
			setCrosswind( enabled ) {
				settings.crosswind = Boolean( enabled )
				flow.crosswindEnabled = settings.crosswind
			},
			setPointer( ndcX, ndcY ) {
				flow.targetRakeX = MathUtils.clamp( ndcX * 0.85, -0.75, 0.75 )
				flow.targetRakeY = MathUtils.clamp( 0.62 + ndcY * 0.6, 0.16, 1.3 )
			},
			setReducedMotion( enabled ) { flow.reducedMotion = Boolean( enabled ) },
			dispose,
		}
		api.resize( canvas?.clientWidth || innerWidth, canvas?.clientHeight || innerHeight )
		return api
	} catch ( error ) {
		dispose()
		throw error
	}
}
