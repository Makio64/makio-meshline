import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, before, test } from 'node:test'

import { createServer } from '../examples/react-three-fiber/node_modules/vite/dist/node/index.js'

const require = createRequire( new URL( '../examples/react-three-fiber/package.json', import.meta.url ) )
const React = require( 'react' )
const { act, createRoot } = require( '@react-three/fiber' )

let MeshLine
let vite

function createCanvas() {
	return {
		width: 640,
		height: 480,
		clientWidth: 640,
		clientHeight: 480,
		style: {},
		addEventListener() {},
		removeEventListener() {},
	}
}

function createRenderer() {
	return {
		domElement: createCanvas(),
		render() {},
		setPixelRatio() {},
		setSize() {},
		forceContextLoss() {},
		renderLists: { dispose() {} },
		shadowMap: { enabled: false, type: null },
		xr: {
			enabled: false,
			isPresenting: false,
			addEventListener() {},
			removeEventListener() {},
			setAnimationLoop() {},
		},
	}
}

async function flushRender( root, element ) {
	await act( async () => {
		root.render( element )
		await Promise.resolve()
	} )
}

before( async () => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	vite = await createServer( {
		root: new URL( '../examples/react-three-fiber', import.meta.url ).pathname,
		server: { middlewareMode: true },
		appType: 'custom',
		logLevel: 'silent',
	} )
	;( { MeshLine } = await vite.ssrLoadModule( '/src/MeshLine.jsx' ) )
} )

after( async () => {
	delete globalThis.IS_REACT_ACT_ENVIRONMENT
	await vite?.close()
} )

test( 'R3F wrapper synchronizes live and structural props without replacing its facade', async () => {
	const canvas = createCanvas()
	const renderer = createRenderer()
	const root = createRoot( canvas )
	await root.configure( {
		gl: renderer,
		frameloop: 'never',
		dpr: 1,
		size: { width: 640, height: 480, top: 0, left: 0 },
	} )

	const ready = []
	const replacementReady = []
	const ref = React.createRef()
	let props = {
		points: new Float32Array( [
			-1, 0, 0,
			0, 1, 0,
			1, 0, 0,
		] ),
		lineWidth: 0.25,
		color: 0x3366ff,
		onReady: line => ready.push( line ),
	}

	const update = async patch => {
		props = { ...props, ...patch }
		await flushRender( root, React.createElement(
			React.StrictMode,
			null,
			React.createElement( MeshLine, { ...props, ref } ),
		) )
	}

	try {
		await update( {} )
		const line = ref.current
		assert.equal( line?.geometry.isMeshLine, true )
		assert.deepEqual( ready, [line] )
		assert.equal( line.parent?.isScene, true )

		const livePoints = new Float32Array( [
			-2, 0, 0,
			0, 2, 0,
			2, 0, 0,
		] )
		await update( {
			points: livePoints,
			lineWidth: 0.8,
			color: 0xff5500,
			opacity: 0.45,
			onReady: value => replacementReady.push( value ),
		} )
		assert.equal( ref.current, line )
		assert.equal( line._options.lines, livePoints )
		assert.equal( line._options.lineWidth, 0.8 )
		assert.equal( line._options.color, 0xff5500 )
		assert.equal( line._options.opacity, 0.45 )
		assert.equal( line.material.transparent, true )
		assert.deepEqual( replacementReady, [] )

		await update( { opacity: 1, antialias: true } )
		assert.equal( ref.current, line )
		assert.equal( line._options.antialias, true )
		assert.equal( line.material.antialias, true )
		assert.equal( line.material.transparent, true )
		await update( { antialias: false } )
		assert.equal( ref.current, line )
		assert.equal( line._options.antialias, false )
		assert.equal( line.material.antialias, false )
		assert.equal( line.material.transparent, false )

		const topologyPoints = new Float32Array( [
			-2, 0, 0,
			-1, 1, 0,
			0, 0, 0,
			1, -1, 0,
			2, 0, 0,
		] )
		await update( { points: topologyPoints, closed: true } )
		assert.equal( ref.current, line )
		assert.equal( line._options.lines, topologyPoints )
		assert.equal( line._options.closed, true )
		assert.ok( line.geometry.getAttribute( 'position' ).count > 6 )

		await update( { points: undefined, segments: 4, closed: false } )
		assert.equal( ref.current, line )
		assert.deepEqual( Array.from( line._options.lines ), [
			0, 0, 0,
			0.25, 0, 0,
			0.5, 0, 0,
			0.75, 0, 0,
			1, 0, 0,
		] )
		assert.equal( line._options.closed, false )
		assert.deepEqual( replacementReady, [] )
		await update( { points: topologyPoints, closed: true } )
		assert.equal( ref.current, line )
		assert.equal( line._options.lines, topologyPoints )

		const billboardGeometry = line.geometry
		let billboardDisposeCount = 0
		billboardGeometry.addEventListener( 'dispose', () => billboardDisposeCount++ )
		await update( {
			surface: true,
			join: { type: 'round', limit: 3, segments: 8, inner: 'clip' },
		} )
		assert.equal( ref.current, line )
		assert.equal( line.geometry.isMeshLineSurfaceGeometry, true )
		assert.equal( line._options.join.inner, 'clip' )
		assert.equal( billboardDisposeCount, 1 )
		await update( { surface: false } )
		assert.equal( ref.current, line )
		assert.equal( line.geometry.isMeshLine, true )

		const firstColor = () => Array.from( line.geometry.getAttribute( 'vertexColor' ).array.subarray( 0, 3 ) )
		await update( { vertexColors: new Float32Array( [1, 0, 0] ) } )
		assert.equal( ref.current, line )
		assert.deepEqual( firstColor(), [1, 0, 0] )
		await update( { vertexColors: new Float32Array( [0, 0, 1] ) } )
		assert.deepEqual( firstColor(), [0, 0, 1] )
		await update( { vertexColors: null } )
		assert.equal( line.geometry.getAttribute( 'vertexColor' ), undefined )
		assert.equal( line.material.options.needsVertexColor, false )

		const hookA = position => position
		const hookB = position => position
		await update( { vertexFn: hookA } )
		assert.equal( ref.current, line )
		assert.equal( line._options.vertexFn, hookA )
		assert.equal( line.material.vertexFn, hookA )
		assert.equal( line.frustumCulled, false )
		await update( { vertexFn: hookB } )
		assert.equal( ref.current, line )
		assert.equal( line._options.vertexFn, hookB )
		assert.equal( line.material.vertexFn, hookB )
		assert.equal( line.frustumCulled, false )
		await update( { vertexFn: null } )
		assert.equal( line.material.vertexFn, null )
		assert.equal( line.frustumCulled, true )
		await update( { vertexFn: hookA, frustumCulled: true } )
		assert.equal( line.frustumCulled, true )
		await update( { frustumCulled: undefined } )
		assert.equal( line.frustumCulled, false )

		let geometryDisposeCount = 0
		let materialDisposeCount = 0
		line.geometry.addEventListener( 'dispose', () => geometryDisposeCount++ )
		line.material.addEventListener( 'dispose', () => materialDisposeCount++ )
		await flushRender( root, null )
		await Promise.resolve()
		assert.equal( ref.current, null )
		assert.equal( line.parent, null )
		assert.equal( geometryDisposeCount, 1 )
		assert.equal( materialDisposeCount, 1 )
		assert.deepEqual( ready, [line] )
	} finally {
		await act( async () => {
			root.unmount()
			await Promise.resolve()
		} )
		await new Promise( resolve => setTimeout( resolve, 550 ) )
	}
} )
