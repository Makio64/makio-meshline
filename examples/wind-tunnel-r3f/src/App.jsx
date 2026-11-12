import { Canvas } from '@react-three/fiber'
import { WIND_TUNNEL_CAMERA } from 'makio-meshline-wind-tunnel-example'
import { Component, useCallback, useEffect, useRef, useState } from 'react'
import { WebGPURenderer } from 'three/webgpu'

import WindTunnel from './WindTunnel.jsx'

const modes = [['tunnel', 'Full tunnel'], ['rake', 'Smoke rake'], ['ground', 'Ground effect']]
const sourceUrl = 'https://github.com/Makio64/makio-meshline'

class CanvasBoundary extends Component {
	state = { error: null }
	static getDerivedStateFromError( error ) { return { error } }
	componentDidCatch( error ) { this.props.onError( error ) }
	render() { return this.state.error ? null : this.props.children }
}

export default function App() {
	const [reducedMotion, setReducedMotion] = useState( () => matchMedia( '(prefers-reduced-motion: reduce)' ).matches )
	const [playing, setPlaying] = useState( () => !matchMedia( '(prefers-reduced-motion: reduce)' ).matches )
	const [visible, setVisible] = useState( () => !document.hidden )
	const [mode, setMode] = useState( 'tunnel' )
	const [wind, setWind] = useState( 200 )
	const [crosswind, setCrosswind] = useState( false )
	const [ready, setReady] = useState( false )
	const [status, setStatus] = useState( 'Starting native WebGPU…' )
	const [error, setError] = useState( () => navigator.gpu ? null : 'This compute scene requires native WebGPU. Open it in a browser with WebGPU enabled over HTTPS or localhost.' )
	const rendererRef = useRef()
	const pendingScene = useRef( Promise.resolve() )
	const mounted = useRef( true )
	const disposeRenderer = useCallback( async () => {
		const renderer = rendererRef.current
		rendererRef.current = undefined
		try {
			await renderer?.dispose()
		} catch ( failure ) {
			console.warn( 'Wind Tunnel renderer cleanup failed:', failure )
		}
	}, [] )
	const onSceneLoad = useCallback( promise => { pendingScene.current = promise }, [] )
	const onError = useCallback( failure => {
		if ( !mounted.current ) return
		setError( failure.message || String( failure ) )
		pendingScene.current.then( disposeRenderer, disposeRenderer )
	}, [disposeRenderer] )
	const onReady = useCallback( () => setReady( true ), [] )
	const onStatus = useCallback( message => setStatus( message ), [] )

	useEffect( () => {
		mounted.current = true
		const media = matchMedia( '(prefers-reduced-motion: reduce)' )
		const preferenceChanged = () => {
			setReducedMotion( media.matches )
			if ( media.matches ) setPlaying( false )
		}
		const visibilityChanged = () => setVisible( !document.hidden )
		media.addEventListener( 'change', preferenceChanged )
		document.addEventListener( 'visibilitychange', visibilityChanged )
		return () => {
			mounted.current = false
			media.removeEventListener( 'change', preferenceChanged )
			document.removeEventListener( 'visibilitychange', visibilityChanged )
			// R3F 9's unmount path releases WebGL contexts but does not call WebGPURenderer.dispose().
			// Wait for a pending scene load to clean up before releasing the host renderer.
			pendingScene.current.then( disposeRenderer, disposeRenderer )
		}
	}, [disposeRenderer] )

	const createRenderer = useCallback( async options => {
		const renderer = new WebGPURenderer( { ...options, antialias: true } )
		rendererRef.current = renderer
		try {
			await renderer.init()
			if ( !mounted.current ) throw new Error( 'Renderer initialization was cancelled.' )
			if ( !renderer.backend.isWebGPUBackend ) throw new Error( 'The renderer selected WebGL2. Wind Tunnel requires native WebGPU compute.' )
			return renderer
		} catch ( failure ) {
			onError( failure )
			await disposeRenderer()
			throw failure
		}
	}, [onError, disposeRenderer] )

	return (
		<main>
			{!error && <CanvasBoundary onError={onError}>
				<Canvas
					camera={{ fov: WIND_TUNNEL_CAMERA.fov, near: WIND_TUNNEL_CAMERA.near, far: WIND_TUNNEL_CAMERA.far, position: WIND_TUNNEL_CAMERA.position }}
					dpr={[1, 1.5]}
					frameloop={!visible ? 'never' : playing ? 'always' : 'demand'}
					gl={createRenderer}
				>
					<WindTunnel playing={playing} reducedMotion={reducedMotion} mode={mode} wind={wind} crosswind={crosswind} onReady={onReady} onStatus={onStatus} onError={onError} onSceneLoad={onSceneLoad} />
				</Canvas>
			</CanvasBoundary>}
			{( !ready || error ) && <div className="loading">
				<img src={`${import.meta.env.BASE_URL}preview.jpg`} alt="Glowing smoke streamlines passing around a hover car" />
				<div className="notice" role={error ? 'alert' : 'status'}>
					<strong>{error ? 'Wind tunnel unavailable' : 'Opening the wind tunnel'}</strong>
					<p>{error || status}</p>
					{error && <button onClick={() => location.reload()}>Try again</button>}
				</div>
			</div>}
			<header><span>Makio MeshLine</span><h1>Wind Tunnel</h1><p>React Three Fiber · V2 development preview · unreleased</p></header>
			<section className="controls" aria-label="Wind tunnel controls">
				<div className="modes">{modes.map( ( [id, label] ) => <button key={id} aria-pressed={mode === id} disabled={!ready || Boolean( error )} onClick={() => setMode( id )}>{label}</button> )}</div>
				<label className="speed"><span>Wind <output>{wind} km/h</output></span><input type="range" min="80" max="500" step="10" value={wind} disabled={!ready || Boolean( error )} onChange={event => setWind( Number( event.target.value ) )} /></label>
				<div className="toggles"><button disabled={!ready || Boolean( error )} onClick={() => setPlaying( !playing )}>{playing ? 'Pause animation' : 'Play animation'}</button><label><input type="checkbox" checked={crosswind} disabled={!ready || Boolean( error )} onChange={event => setCrosswind( event.target.checked )} />Crosswind</label></div>
				<p>Drag to orbit · move to steer airflow{reducedMotion ? ' · reduced motion' : ''}</p>
			</section>
			<footer><a href={sourceUrl}>Source workspace</a><a href="https://meshline.makio.io/">MeshLine docs</a></footer>
		</main>
	)
}
