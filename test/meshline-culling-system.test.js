import assert from 'node:assert/strict'
import test from 'node:test'

import { IndirectStorageBufferAttribute, PerspectiveCamera, Scene } from 'three/webgpu'

import MeshLine from '../src/MeshLine.js'
import MeshLineCullingSystem from '../src/MeshLineCullingSystem.js'

const createLine = () => new MeshLine()
	.lines( new Float32Array( [
		-2, 0, 0,
		-1, 0.5, 0,
		0, 0, 0,
		1, -0.5, 0,
		2, 0, 0,
	] ) )
	.build()

const createNativeRendererStub = () => {
	const renderer = {
		isWebGPURenderer: true,
		backend: { isWebGPUBackend: true, device: {} },
		computeCalls: [],
		readbackCalls: [],
		async init() {},
		compute( nodes ) {
			this.computeCalls.push( nodes )
		},
		async getArrayBufferAsync( attribute ) {
			this.readbackCalls.push( attribute )
			return attribute.array.buffer.slice( 0 )
		},
	}
	return renderer
}

test( 'native culling warms INDEX|STORAGE, selects indirect only for the prepared camera, and restores state', async () => {
	const renderer = createNativeRendererStub()
	const scene = new Scene()
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 )
	camera.position.z = 8
	const otherCamera = camera.clone()
	const line = createLine()
	const originalIndex = line.geometry.getIndex()
	const originalBeforeRender = line.onBeforeRender
	const originalAfterRender = line.onAfterRender
	const originalFrustumCulled = line.frustumCulled
	const originalSceneBeforeRender = scene.onBeforeRender
	const originalSceneAfterRender = scene.onAfterRender
	const system = MeshLineCullingSystem.attach( renderer, scene, { autoUpdate: false, chunkSize: 2, mode: 'webgpu' } )
	const handle = system.add( line )

	assert.equal( handle.enabled, true )
	assert.equal( handle.chunkCount, 4 )
	assert.equal( line.frustumCulled, false )

	line.onBeforeRender( renderer, scene, camera, line.geometry, line.material, null )
	const compactIndex = line.geometry.getIndex()
	assert.notEqual( compactIndex, originalIndex )
	assert.equal( compactIndex.isStorageBufferAttribute, true )
	assert.equal( line.geometry.getIndirect(), null )
	line.onAfterRender( renderer, scene, camera, line.geometry, line.material, null )

	assert.equal( handle.warmedUp, true )
	assert.equal( line.geometry.getIndex(), originalIndex )
	assert.equal( line.geometry.getIndirect(), null )
	assert.equal( await system.update( camera ), true )
	assert.equal( renderer.computeCalls.length, 1 )
	assert.equal( renderer.computeCalls[0].length, 2 )
	camera.far = Infinity
	camera.updateProjectionMatrix()
	assert.equal( await system.update( camera ), false )
	assert.match( handle.reason, /far plane|finite/ )
	assert.equal( renderer.computeCalls.length, 1 )
	camera.far = 100
	camera.updateProjectionMatrix()
	assert.equal( await system.update( camera ), true )
	const settledComputeCount = renderer.computeCalls.length
	assert.equal( await system.update( camera ), true )
	assert.equal( renderer.computeCalls.length, settledComputeCount )
	camera.position.x = 1
	assert.equal( await system.update( camera ), true )
	assert.equal( renderer.computeCalls.length, settledComputeCount + 1 )

	line.onBeforeRender( renderer, scene, camera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex(), compactIndex )
	assert.equal( line.geometry.getIndirect().isIndirectStorageBufferAttribute, true )
	line.onAfterRender( renderer, scene, camera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex(), originalIndex )
	assert.equal( line.geometry.getIndirect(), null )

	line.onBeforeRender( renderer, scene, otherCamera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex(), originalIndex )
	assert.equal( line.geometry.getIndirect(), null )
	line.onAfterRender( renderer, scene, otherCamera, line.geometry, line.material, null )

	handle.remove()
	assert.equal( line.geometry.getIndex(), originalIndex )
	assert.equal( line.geometry.getIndirect(), null )
	assert.equal( line.onBeforeRender, originalBeforeRender )
	assert.equal( line.onAfterRender, originalAfterRender )
	assert.equal( line.frustumCulled, originalFrustumCulled )
	system.dispose()
	assert.equal( scene.onBeforeRender, originalSceneBeforeRender )
	assert.equal( scene.onAfterRender, originalSceneAfterRender )
} )

test( 'explicit visibility readback reports exact visible and culled source-index chunks', async () => {
	const renderer = createNativeRendererStub()
	const scene = new Scene()
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 )
	const line = createLine()
	const system = MeshLineCullingSystem.attach( renderer, scene, { autoUpdate: false, chunkSize: 2, mode: 'webgpu' } )
	const handle = system.add( line )

	assert.equal( await handle.readCullingSnapshot(), null )
	assert.equal( renderer.readbackCalls.length, 0 )

	line.onBeforeRender( renderer, scene, camera, line.geometry, line.material, null )
	line.onAfterRender( renderer, scene, camera, line.geometry, line.material, null )
	assert.equal( await system.update( camera ), true )
	assert.equal( renderer.readbackCalls.length, 0, 'normal updates must remain readback-free' )

	handle._resources.visibilityAttribute.array.set( [1, 0, 0, 1] )
	const firstRead = handle.readCullingSnapshot()
	const duplicateRead = handle.readCullingSnapshot()
	assert.equal( duplicateRead, firstRead, 'concurrent reads of one revision should share a readback' )
	const snapshot = await firstRead

	assert.equal( renderer.readbackCalls.length, 1 )
	assert.equal( renderer.readbackCalls[0], handle._resources.visibilityAttribute )
	assert.equal( snapshot.camera, camera )
	assert.equal( snapshot.revision, 1 )
	assert.equal( snapshot.chunkCount, 4 )
	assert.equal( snapshot.indexCount, 24 )
	assert.equal( snapshot.visibleChunkCount, 2 )
	assert.equal( snapshot.culledChunkCount, 2 )
	assert.equal( snapshot.visibleIndexCount, 12 )
	assert.equal( snapshot.culledIndexCount, 12 )
	assert.deepEqual( snapshot.visibleChunks, [
		{ chunkIndex: 0, indexStart: 0, indexCount: 6 },
		{ chunkIndex: 3, indexStart: 18, indexCount: 6 },
	] )
	assert.deepEqual( snapshot.culledChunks, [
		{ chunkIndex: 1, indexStart: 6, indexCount: 6 },
		{ chunkIndex: 2, indexStart: 12, indexCount: 6 },
	] )
	assert.equal( await handle.readCullingSnapshot(), snapshot, 'an unchanged revision should reuse its completed snapshot' )
	assert.equal( renderer.readbackCalls.length, 1 )

	camera.position.x = 1
	camera.updateWorldMatrix( true, false )
	assert.equal( await handle.readCullingSnapshot(), null, 'a changed camera must not expose the stale selection' )
	assert.equal( renderer.readbackCalls.length, 1 )

	handle.remove()
	assert.equal( await handle.readCullingSnapshot(), null )
	system.dispose()
} )

test( 'a current readback failure rejects without poisoning a later retry', async () => {
	const renderer = createNativeRendererStub()
	const scene = new Scene()
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 )
	const line = createLine()
	const system = MeshLineCullingSystem.attach( renderer, scene, { autoUpdate: false, mode: 'webgpu' } )
	const handle = system.add( line )

	line.onBeforeRender( renderer, scene, camera, line.geometry, line.material, null )
	line.onAfterRender( renderer, scene, camera, line.geometry, line.material, null )
	assert.equal( await system.update( camera ), true )
	renderer.getArrayBufferAsync = async () => {
		throw new Error( 'readback failed' )
	}
	await assert.rejects( handle.readCullingSnapshot(), /readback failed/ )

	renderer.getArrayBufferAsync = async attribute => attribute.array.buffer.slice( 0 )
	handle._resources.visibilityAttribute.array.fill( 1 )
	const snapshot = await handle.readCullingSnapshot()
	assert.equal( snapshot.visibleChunkCount, snapshot.chunkCount )

	system.dispose()
} )

test( 'visibility readback preserves its call-time revision while a newer cull is dispatched', async () => {
	const renderer = createNativeRendererStub()
	const scene = new Scene()
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 )
	const line = createLine()
	const system = MeshLineCullingSystem.attach( renderer, scene, { autoUpdate: false, mode: 'webgpu' } )
	const handle = system.add( line )
	let finishReadback = null

	renderer.getArrayBufferAsync = attribute => {
		renderer.readbackCalls.push( attribute )
		const captured = attribute.array.buffer.slice( 0 )
		return new Promise( resolve => {
			finishReadback = () => resolve( captured )
		} )
	}
	line.onBeforeRender( renderer, scene, camera, line.geometry, line.material, null )
	line.onAfterRender( renderer, scene, camera, line.geometry, line.material, null )
	assert.equal( await system.update( camera ), true )
	handle._resources.visibilityAttribute.array.set( [1] )

	const pending = handle.readCullingSnapshot()
	assert.equal( renderer.readbackCalls.length, 1 )
	camera.position.x = 1
	assert.equal( await system.update( camera ), true )
	assert.equal( handle._cullingRevision, 2 )
	handle._resources.visibilityAttribute.array.set( [0] )
	finishReadback()
	const snapshot = await pending
	assert.equal( snapshot.revision, 1 )
	assert.equal( snapshot.visibleChunkCount, 1 )
	assert.equal( snapshot.culledChunkCount, 0 )

	system.dispose()
} )

test( 'same-capacity position updates refresh chunk bounds while topology changes fail open until refresh', async () => {
	const renderer = createNativeRendererStub()
	const scene = new Scene()
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 )
	const line = createLine()
	const system = MeshLineCullingSystem.attach( renderer, scene, { autoUpdate: false, mode: 'webgpu' } )
	const handle = system.add( line )

	line.onBeforeRender( renderer, scene, camera, line.geometry, line.material, null )
	line.onAfterRender( renderer, scene, camera, line.geometry, line.material, null )
	const position = line.geometry.getAttribute( 'position' )
	position.setX( 0, -3 )
	position.needsUpdate = true
	assert.equal( await system.update( camera ), true )
	assert.equal( handle.positionVersion, position.version )

	const replacement = originalIndexClone( line.geometry.getIndex() )
	line.geometry.setIndex( replacement )
	assert.equal( await system.update( camera ), false )
	assert.match( handle.reason, /refresh/ )
	assert.equal( line.geometry.getIndex(), replacement )
	line.onBeforeRender( renderer, scene, camera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex(), replacement )
	line.onAfterRender( renderer, scene, camera, line.geometry, line.material, null )

	assert.equal( handle.refresh(), true )
	assert.equal( handle.warmedUp, false )
	handle.remove()
	system.dispose()
} )

test( 'unsupported backends and pre-existing indirect draws stay fail-open and restore callbacks', () => {
	const renderer = { isWebGPURenderer: true, backend: { isWebGPUBackend: false } }
	const scene = new Scene()
	const line = createLine()
	const originalIndex = line.geometry.getIndex()
	const originalBeforeRender = line.onBeforeRender
	const originalAfterRender = line.onAfterRender
	const originalFrustumCulled = line.frustumCulled
	const system = MeshLineCullingSystem.attach( renderer, scene )
	const handle = system.add( line )

	assert.equal( handle.enabled, false )
	assert.equal( line.geometry.getIndex(), originalIndex )
	assert.equal( line.frustumCulled, false )
	handle.remove()
	assert.equal( line.onBeforeRender, originalBeforeRender )
	assert.equal( line.onAfterRender, originalAfterRender )
	assert.equal( line.frustumCulled, originalFrustumCulled )
	system.dispose()

	const nativeRenderer = createNativeRendererStub()
	const secondScene = new Scene()
	const secondLine = createLine()
	const originalIndirect = new IndirectStorageBufferAttribute( new Uint32Array( [secondLine.geometry.getIndex().count, 1, 0, 0, 0] ), 1 )
	secondLine.geometry.setIndirect( originalIndirect, 20 )
	const secondSystem = MeshLineCullingSystem.attach( nativeRenderer, secondScene )
	const secondHandle = secondSystem.add( secondLine )
	assert.equal( secondHandle.enabled, false )
	assert.match( secondHandle.reason, /existing indirect/ )
	assert.equal( secondLine.geometry.getIndirect(), originalIndirect )
	assert.equal( secondLine.geometry.indirectOffset, 20 )
	secondHandle.remove()
	assert.equal( secondLine.geometry.getIndirect(), originalIndirect )
	assert.equal( secondLine.geometry.indirectOffset, 20 )
	secondSystem.dispose()
} )

test( 'auto mode keeps small geometry on CPU culling while webgpu mode can force the GPU path', () => {
	const autoRenderer = createNativeRendererStub()
	const autoScene = new Scene()
	const autoLine = createLine()
	const originalFrustumCulled = autoLine.frustumCulled
	const autoSystem = MeshLineCullingSystem.attach( autoRenderer, autoScene )
	const autoHandle = autoSystem.add( autoLine )

	assert.equal( autoHandle.enabled, false )
	assert.match( autoHandle.reason, /threshold/ )
	assert.equal( autoLine.frustumCulled, originalFrustumCulled )
	autoSystem.dispose()

	const forcedRenderer = createNativeRendererStub()
	const forcedScene = new Scene()
	const forcedLine = createLine()
	const forcedSystem = MeshLineCullingSystem.attach( forcedRenderer, forcedScene, { mode: 'webgpu' } )
	const forcedHandle = forcedSystem.add( forcedLine )
	assert.equal( forcedHandle.enabled, true )
	forcedSystem.dispose()
} )

test( 'nested scene renders draw all without replacing the outer camera compaction', () => {
	const renderer = createNativeRendererStub()
	const scene = new Scene()
	const mainCamera = new PerspectiveCamera( 50, 1, 0.1, 100 )
	const shadowCamera = mainCamera.clone()
	const line = createLine()
	const originalIndex = line.geometry.getIndex()
	const system = MeshLineCullingSystem.attach( renderer, scene, { chunkSize: 2, mode: 'webgpu' } )
	const handle = system.add( line )

	line.onBeforeRender( renderer, scene, mainCamera, line.geometry, line.material, null )
	const compactIndex = line.geometry.getIndex()
	line.onAfterRender( renderer, scene, mainCamera, line.geometry, line.material, null )
	assert.equal( handle.warmedUp, true )

	scene.onBeforeRender( renderer, scene, mainCamera, null )
	assert.equal( renderer.computeCalls.length, 1 )
	assert.equal( system._preparedCamera, mainCamera )
	line.onBeforeRender( renderer, scene, mainCamera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex(), compactIndex )
	assert.equal( line.geometry.getIndirect().isIndirectStorageBufferAttribute, true )

	scene.onBeforeRender( renderer, scene, shadowCamera, null )
	assert.equal( renderer.computeCalls.length, 1 )
	assert.equal( system._preparedCamera, mainCamera )
	line.onBeforeRender( renderer, scene, mainCamera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex(), originalIndex )
	assert.equal( line.geometry.getIndirect(), null )
	line.onAfterRender( renderer, scene, mainCamera, line.geometry, line.material, null )
	scene.onAfterRender( renderer, scene, shadowCamera, null )
	assert.equal( line.geometry.getIndex(), compactIndex )
	assert.equal( line.geometry.getIndirect().isIndirectStorageBufferAttribute, true )
	line.onAfterRender( renderer, scene, mainCamera, line.geometry, line.material, null )

	line.onBeforeRender( renderer, scene, mainCamera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex(), compactIndex )
	assert.equal( line.geometry.getIndirect().isIndirectStorageBufferAttribute, true )
	line.onAfterRender( renderer, scene, mainCamera, line.geometry, line.material, null )
	scene.onAfterRender( renderer, scene, mainCamera, null )
	scene.onBeforeRender( renderer, scene, mainCamera, null )
	assert.equal( renderer.computeCalls.length, 1 )
	scene.onAfterRender( renderer, scene, mainCamera, null )

	system.dispose()
} )

test( 'warm-up and scene updates are scoped to the attached renderer and scene', () => {
	const renderer = createNativeRendererStub()
	const otherRenderer = createNativeRendererStub()
	const scene = new Scene()
	const otherScene = new Scene()
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 )
	const line = createLine()
	const originalIndex = line.geometry.getIndex()
	const system = MeshLineCullingSystem.attach( renderer, scene, { mode: 'webgpu' } )
	const handle = system.add( line )

	line.onBeforeRender( otherRenderer, scene, camera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex(), originalIndex )
	line.onAfterRender( otherRenderer, scene, camera, line.geometry, line.material, null )
	line.onBeforeRender( renderer, otherScene, camera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex(), originalIndex )
	line.onAfterRender( renderer, otherScene, camera, line.geometry, line.material, null )
	assert.equal( handle.warmedUp, false )

	scene.onBeforeRender( otherRenderer, scene, camera, null )
	scene.onAfterRender( otherRenderer, scene, camera, null )
	assert.equal( renderer.computeCalls.length, 0 )
	assert.equal( otherRenderer.computeCalls.length, 0 )

	system.dispose()
} )

test( 'warm-up synchronizes an in-place source-index edit made after refresh', () => {
	const renderer = createNativeRendererStub()
	const scene = new Scene()
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 )
	const line = createLine()
	const sourceIndex = line.geometry.getIndex()
	const system = MeshLineCullingSystem.attach( renderer, scene, { mode: 'webgpu' } )
	const handle = system.add( line )

	sourceIndex.array[0] = 1
	sourceIndex.needsUpdate = true
	line.onBeforeRender( renderer, scene, camera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex().array[0], 1 )
	line.onAfterRender( renderer, scene, camera, line.geometry, line.material, null )
	assert.equal( handle.indexVersion, sourceIndex.version )

	system.dispose()
} )

test( 'scene override materials always use the complete source draw', async () => {
	const renderer = createNativeRendererStub()
	const scene = new Scene()
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 )
	const line = createLine()
	const sourceIndex = line.geometry.getIndex()
	const system = MeshLineCullingSystem.attach( renderer, scene, { autoUpdate: false, mode: 'webgpu' } )
	const handle = system.add( line )

	line.onBeforeRender( renderer, scene, camera, line.geometry, line.material, null )
	line.onAfterRender( renderer, scene, camera, line.geometry, line.material, null )
	assert.equal( handle.warmedUp, true )
	assert.equal( await system.update( camera ), true )

	scene.overrideMaterial = line.material
	line.onBeforeRender( renderer, scene, camera, line.geometry, line.material, null )
	assert.equal( line.geometry.getIndex(), sourceIndex )
	assert.equal( line.geometry.getIndirect(), null )
	line.onAfterRender( renderer, scene, camera, line.geometry, line.material, null )

	scene.overrideMaterial = null
	system.dispose()
} )

test( 'remove preserves later callbacks and scene hook chains survive out-of-order disposal', () => {
	const rendererA = createNativeRendererStub()
	const rendererB = createNativeRendererStub()
	const scene = new Scene()
	const originalSceneBefore = scene.onBeforeRender
	const originalSceneAfter = scene.onAfterRender
	const line = createLine()
	const systemA = MeshLineCullingSystem.attach( rendererA, scene, { mode: 'webgpu' } )
	const handle = systemA.add( line )
	const laterBefore = () => {}
	const laterAfter = () => {}
	line.onBeforeRender = laterBefore
	line.onAfterRender = laterAfter
	handle.remove()
	assert.equal( line.onBeforeRender, laterBefore )
	assert.equal( line.onAfterRender, laterAfter )

	const systemB = MeshLineCullingSystem.attach( rendererB, scene, { mode: 'webgpu' } )
	assert.equal( scene.onBeforeRender, systemB._sceneBeforeRenderHook )
	systemA.dispose()
	assert.equal( scene.onBeforeRender, systemB._sceneBeforeRenderHook )
	assert.equal( scene.onAfterRender, systemB._sceneAfterRenderHook )
	systemB.dispose()
	assert.equal( scene.onBeforeRender, originalSceneBefore )
	assert.equal( scene.onAfterRender, originalSceneAfter )

	const sceneWithLaterCallback = new Scene()
	const systemC = MeshLineCullingSystem.attach( createNativeRendererStub(), sceneWithLaterCallback, { mode: 'webgpu' } )
	const laterSceneBefore = () => {}
	const laterSceneAfter = () => {}
	sceneWithLaterCallback.onBeforeRender = laterSceneBefore
	sceneWithLaterCallback.onAfterRender = laterSceneAfter
	systemC.dispose()
	assert.equal( sceneWithLaterCallback.onBeforeRender, laterSceneBefore )
	assert.equal( sceneWithLaterCallback.onAfterRender, laterSceneAfter )
} )

const originalIndexClone = index => index.clone()
