import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, before, test } from 'node:test'

import { createServer } from '../examples/vue/node_modules/vite/dist/node/index.js'

const require = createRequire( new URL( '../examples/vue/package.json', import.meta.url ) )
const {
	createRenderer,
	h,
	nextTick,
	provide,
	reactive,
	ref,
	shallowRef,
	ssrContextKey,
	unref,
} = require( 'vue' )
const { Group } = await import( require.resolve( 'three/webgpu' ) )

let MeshLine
let vite

function createHostNode( type, text = '' ) {
	return { type, text, children: [], parent: null, props: {} }
}

const hostRenderer = createRenderer( {
	patchProp( element, key, _previous, value ) {
		element.props[key] = value
	},
	insert( child, parent, anchor = null ) {
		child.parent = parent
		const index = anchor ? parent.children.indexOf( anchor ) : -1
		if ( index === -1 ) parent.children.push( child )
		else parent.children.splice( index, 0, child )
	},
	remove( child ) {
		const parent = child.parent
		if ( !parent ) return
		const index = parent.children.indexOf( child )
		if ( index !== -1 ) parent.children.splice( index, 1 )
		child.parent = null
	},
	createElement: type => createHostNode( type ),
	createText: text => createHostNode( 'text', text ),
	createComment: text => createHostNode( 'comment', text ),
	setText( node, text ) {
		node.text = text
	},
	setElementText( node, text ) {
		node.text = text
		node.children.length = 0
	},
	parentNode: node => node.parent,
	nextSibling( node ) {
		const siblings = node.parent?.children
		if ( !siblings ) return null
		return siblings[siblings.indexOf( node ) + 1] ?? null
	},
	querySelector: () => null,
	setScopeId() {},
	cloneNode( node ) {
		return { ...node, children: [...node.children], parent: null, props: { ...node.props } }
	},
	insertStaticContent() {
		const node = createHostNode( 'static' )
		return [node, node]
	},
} )

before( async () => {
	vite = await createServer( {
		root: new URL( '../examples/vue', import.meta.url ).pathname,
		server: { middlewareMode: true },
		appType: 'custom',
		logLevel: 'silent',
	} )
	;( { default: MeshLine } = await vite.ssrLoadModule( '/src/MeshLine.vue' ) )
	MeshLine.render = () => null
} )

after( async () => {
	await vite?.close()
} )

test( 'Vue wrapper keeps its exposed facade stable across live and structural updates', async () => {
	const scene = new Group()
	const sceneRef = shallowRef( scene )
	const wrapperRef = ref( null )
	const ready = []
	const state = reactive( {
		points: new Float32Array( [
			-1, 0, 0,
			0, 1, 0,
			1, 0, 0,
		] ),
		lineWidth: 0.25,
		color: 0x3366ff,
	} )
	const Root = {
		setup() {
			provide( ssrContextKey, { modules: new Set() } )
			provide( 'meshline-parent', sceneRef )
			return () => h( MeshLine, {
				...state,
				ref: wrapperRef,
				onReady: line => ready.push( line ),
			} )
		},
	}
	const app = hostRenderer.createApp( Root )
	const container = createHostNode( 'root' )

	const update = async patch => {
		Object.assign( state, patch )
		await nextTick()
		await nextTick()
	}

	app.mount( container )
	await nextTick()
	const line = unref( wrapperRef.value?.line )
	assert.equal( line?.geometry.isMeshLine, true )
	assert.deepEqual( ready, [line] )
	assert.equal( line.parent, scene )

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
	} )
	assert.equal( unref( wrapperRef.value?.line ), line )
	assert.equal( line._options.lines, livePoints )
	assert.equal( line._options.lineWidth, 0.8 )
	assert.equal( line._options.color, 0xff5500 )
	assert.equal( line._options.opacity, 0.45 )
	assert.equal( line.material.transparent, true )

	const topologyPoints = new Float32Array( [
		-2, 0, 0,
		-1, 1, 0,
		0, 0, 0,
		1, -1, 0,
		2, 0, 0,
	] )
	await update( { points: topologyPoints, closed: true } )
	assert.equal( unref( wrapperRef.value?.line ), line )
	assert.equal( line._options.lines, topologyPoints )
	assert.equal( line._options.closed, true )
	assert.ok( line.geometry.getAttribute( 'position' ).count > 6 )

	const billboardGeometry = line.geometry
	let billboardDisposeCount = 0
	billboardGeometry.addEventListener( 'dispose', () => billboardDisposeCount++ )
	await update( { surface: true } )
	assert.equal( unref( wrapperRef.value?.line ), line )
	assert.equal( line.geometry.isMeshLineSurfaceGeometry, true )
	assert.equal( billboardDisposeCount, 1 )
	await update( { surface: false } )
	assert.equal( unref( wrapperRef.value?.line ), line )
	assert.equal( line.geometry.isMeshLine, true )

	const hookA = position => position
	const hookB = position => position
	await update( { vertexFn: hookA } )
	assert.equal( unref( wrapperRef.value?.line ), line )
	assert.equal( line._options.vertexFn, hookA )
	assert.equal( line.material.vertexFn, hookA )
	assert.equal( line.frustumCulled, false )
	await update( { vertexFn: hookB } )
	assert.equal( unref( wrapperRef.value?.line ), line )
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
	assert.deepEqual( ready, [line] )

	let geometryDisposeCount = 0
	let materialDisposeCount = 0
	line.geometry.addEventListener( 'dispose', () => geometryDisposeCount++ )
	line.material.addEventListener( 'dispose', () => materialDisposeCount++ )
	app.unmount()
	await nextTick()
	assert.equal( wrapperRef.value, null )
	assert.equal( line.parent, null )
	assert.equal( scene.children.includes( line ), false )
	assert.equal( geometryDisposeCount, 1 )
	assert.equal( materialDisposeCount, 1 )
} )
