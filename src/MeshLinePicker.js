import { float, Fn, instanceIndex, uniform, vec4 } from 'three/tsl'
import { Color, Mesh, NoColorSpace, NoToneMapping, RenderTarget, RGBAFormat, Scene, UnsignedByteType, Vector2 } from 'three/webgpu'

import MeshLineNodeMaterial from './MeshLineNodeMaterial.js'

const _size = new Vector2()
const _savedClearColor = new Color()

class MeshLinePickingMaterial extends MeshLineNodeMaterial {

	static get type() {
		return 'MeshLinePickingMaterial'
	}

	constructor() {
		super()
		this.type = 'MeshLinePickingMaterial'
		this.isMeshLinePickingMaterial = true
		this._slot = uniform( 0 )
	}

	setSlot( slot ) {
		this._slot.value = slot / 255
	}

	buildLine( options = {} ) {
		super.buildLine( options )
		this.transparent = false
		this.alphaTest = 0
		this.depthWrite = true
	}

	setupShaders( builder ) {
		super.setupShaders( builder )

		const slotF = this._slot
		const instanced = this.options && this.options.instanceCount > 0

		this.colorNode = Fn( () => {
			if ( instanced ) {
				const idx = float( instanceIndex )
				const hi = idx.div( 256 ).floor()
				const lo = idx.sub( hi.mul( 256 ) )
				return vec4( slotF, hi.div( 255 ), lo.div( 255 ), 1 )
			}
			return vec4( slotF, float( 0 ), float( 0 ), 1 )
		} )()

		this.opacityNode = float( 1 )
	}

}

/**
 * GPU pixel-picker for MeshLines. Renders registered lines with unique ID colors
 * to an offscreen target and reads back the pixel under the cursor to identify
 * which line / instance was hit.
 *
 * Works with GPU-positioned lines, instanced lines (any count), animated lines
 * and hook-driven geometry — because it reads what was rendered, not a CPU proxy.
 *
 * @example
 * const picker = new MeshLinePicker( renderer, scene, camera )
 * picker.add( meshLine )
 * window.addEventListener( 'pointermove', async ( e ) => {
 *   const hit = await picker.pick( e.clientX, e.clientY )
 *   if ( hit ) console.log( hit.line, hit.instanceId )
 * } )
 */
export default class MeshLinePicker {

	/**
	 * @param {import('three/webgpu').WebGPURenderer} renderer
	 * @param {import('three/webgpu').Scene} scene
	 * @param {import('three/webgpu').Camera} camera
	 * @param {{ targetSize?: number, hitRadius?: number }} [options]
	 *   - `hitRadius` multiplies the registered line's width when drawn into the
	 *     picking pass, making thin lines easier to hit (like raycast's `threshold`).
	 *     Default 15. Set to 1 for pixel-exact picking.
	 */
	constructor( renderer, scene, camera, { targetSize = 1, hitRadius = 15 } = {} ) {
		this.renderer = renderer
		this.scene = scene
		this.camera = camera
		this.targetSize = Math.max( 1, targetSize )
		this.hitRadius = Math.max( 1, hitRadius )

		this._pickScene = new Scene()
		this._registry = new Map()
		this._lineToSlot = new Map()
		this._nextSlot = 1

		this._deviceTargetSize = 0
		this._target = new RenderTarget( 1, 1, {
			format: RGBAFormat,
			type: UnsignedByteType,
			depthBuffer: true,
			stencilBuffer: false,
		} )
		this._target.texture.colorSpace = NoColorSpace
		this._target.texture.generateMipmaps = false
		this._bytesPerRow = 256
		this._ensureTargetSize()
		this._picking = false
		this._disposed = false
	}

	_ensureTargetSize() {
		const deviceTargetSize = Math.max( 1, Math.ceil( this.targetSize * this.renderer.getPixelRatio() ) )
		if ( deviceTargetSize === this._deviceTargetSize ) return

		this._deviceTargetSize = deviceTargetSize
		this._target.setSize( deviceTargetSize, deviceTargetSize )

		// WebGPU enforces 256-byte row alignment on texture-to-buffer copies, so the
		// readback may be zero-padded per row. Track the padded stride for indexing.
		this._bytesPerRow = Math.max( 256, Math.ceil( deviceTargetSize * 4 / 256 ) * 256 )
	}

	/**
	 * Register a MeshLine for picking. The line's transform is tracked automatically.
	 * @param {import('./MeshLine.js').default} line
	 * @returns {this}
	 */
	add( line ) {
		if ( this._disposed ) return this
		if ( !line || !line.isMesh ) {
			console.warn( 'MeshLinePicker.add: expected a MeshLine (or Mesh).' )
			return this
		}
		if ( this._lineToSlot.has( line ) ) return this
		if ( this._nextSlot > 255 ) {
			console.warn( 'MeshLinePicker: slot limit reached (max 255 registered lines).' )
			return this
		}

		if ( typeof line.ensureBuilt === 'function' ) line.ensureBuilt()

		const slot = this._nextSlot++
		const material = new MeshLinePickingMaterial()
		const options = line._options ?? {}
		material.buildLine( {
			...options,
			needsVertexColor: false,
		} )
		material.setSlot( slot )

		const proxy = new Mesh( line.geometry, material )
		proxy.frustumCulled = false
		proxy.matrixAutoUpdate = false
		proxy.matrixWorldAutoUpdate = false
		if ( line.count > 0 ) proxy.count = line.count
		this._pickScene.add( proxy )

		const entry = { line, proxy, material }
		this._registry.set( slot, entry )
		this._lineToSlot.set( line, slot )
		this._syncProxyMaterial( entry )
		return this
	}

	/**
	 * Unregister a MeshLine and dispose its picking material.
	 * @param {import('./MeshLine.js').default} line
	 * @returns {this}
	 */
	remove( line ) {
		const slot = this._lineToSlot.get( line )
		if ( slot === undefined ) return this
		const entry = this._registry.get( slot )
		this._pickScene.remove( entry.proxy )
		entry.material.dispose()
		this._registry.delete( slot )
		this._lineToSlot.delete( line )
		return this
	}

	/**
	 * Pick the line/instance under a canvas-relative pixel coordinate.
	 * @param {number} x - CSS pixel, relative to the renderer's canvas (like `event.clientX - canvas.left`)
	 * @param {number} y - CSS pixel, relative to the renderer's canvas (like `event.clientY - canvas.top`)
	 * @returns {Promise<{ line: import('./MeshLine.js').default, instanceId: number } | null>}
	 */
	async pick( x, y ) {
		if ( this._disposed || this._picking || this._registry.size === 0 ) return null
		this._picking = true

		try {
			this._ensureTargetSize()
			this.renderer.getDrawingBufferSize( _size )
			const dpr = this.renderer.getPixelRatio()
			const px = Math.floor( x * dpr )
			const py = Math.floor( y * dpr )

			if ( px < 0 || py < 0 || px >= _size.width || py >= _size.height ) return null

			this._syncProxies()

			const savedView = this.camera.view ? { ...this.camera.view } : null
			const savedAspect = this.camera.aspect
			const savedTarget = this.renderer.getRenderTarget()
			const savedActiveMipLevel = this.renderer.getActiveMipmapLevel?.() ?? 0
			const savedClearAlpha = this.renderer.getClearAlpha()
			this.renderer.getClearColor( _savedClearColor )
			const savedToneMapping = this.renderer.toneMapping
			const savedOutputColorSpace = this.renderer.outputColorSpace
			this.renderer.toneMapping = NoToneMapping
			this.renderer.outputColorSpace = NoColorSpace

			const ts = this._deviceTargetSize
			const offX = px - Math.floor( ts / 2 )
			const offY = py - Math.floor( ts / 2 )
			this.camera.setViewOffset( _size.width, _size.height, offX, offY, ts, ts )

			this.renderer.setRenderTarget( this._target )
			this.renderer.setClearColor( 0x000000, 0 )
			this.renderer.clear( true, true, false )
			this.renderer.render( this._pickScene, this.camera )

			// Restore renderer & camera state BEFORE awaiting the async readback.
			// The main animation loop keeps firing while we await — if the picker target
			// stays bound, the next frame is drawn into our tiny target and the canvas
			// freezes. readRenderTargetPixelsAsync takes the target as an explicit arg,
			// so the readback still reads the right texture after restore.
			this.renderer.setRenderTarget( savedTarget, savedActiveMipLevel )
			this.renderer.setClearColor( _savedClearColor, savedClearAlpha )
			this.renderer.toneMapping = savedToneMapping
			this.renderer.outputColorSpace = savedOutputColorSpace
			this.camera.view = savedView
			this.camera.aspect = savedAspect
			this.camera.updateProjectionMatrix()

			const data = await this.renderer.readRenderTargetPixelsAsync(
				this._target, 0, 0, ts, ts, 0
			)
			const buffer = new Uint8Array( data )
			const packedStride = ts * 4
			const stride = buffer.length === packedStride * ts ? packedStride : this._bytesPerRow

			const center = Math.floor( ts / 2 )
			const order = this._pixelOrder( ts )
			for ( const [ox, oy] of order ) {
				const pi = ( center + oy ) * stride + ( center + ox ) * 4
				const r = buffer[ pi ]
				const g = buffer[ pi + 1 ]
				const b = buffer[ pi + 2 ]
				const a = buffer[ pi + 3 ]
				if ( a === 0 || r === 0 ) continue
				const entry = this._registry.get( r )
				if ( !entry ) continue
				const instanceId = ( g << 8 ) | b
				return {
					line: entry.line,
					instanceId: entry.line.count > 0 ? instanceId : -1,
				}
			}
			return null
		} finally {
			this._picking = false
		}
	}

	/**
	 * Snapshot of the currently registered lines, in registration order.
	 * @returns {Array<import('./MeshLine.js').default>}
	 */
	get lines() {
		const out = []
		for ( const entry of this._registry.values() ) out.push( entry.line )
		return out
	}

	_syncProxyMaterial( entry ) {
		const src = entry.line.material
		entry.material.lineWidth.value = src.lineWidth.value * this.hitRadius
		entry.material.dpr.value = src.dpr.value
		entry.material.resolution.value.copy( src.resolution.value )
	}

	/**
	 * Copy each registered line's transform & instance count onto its proxy so the
	 * picking scene renders in the correct place. Called internally by `pick()`
	 * before the pick render; exposed publicly for debug rendering.
	 */
	_syncProxies() {
		this.scene.updateMatrixWorld()
		for ( const entry of this._registry.values() ) {
			if ( entry.line.count > 0 ) entry.proxy.count = entry.line.count
			entry.proxy.matrixWorld.copy( entry.line.matrixWorld )
			entry.proxy.visible = entry.line.visible
			entry.proxy.renderOrder = entry.line.renderOrder
			this._syncProxyMaterial( entry )
		}
	}

	/**
	 * The internal "picking" scene containing the registered lines' ID-colored
	 * proxy meshes. Render it directly to the canvas to visually debug what the
	 * picker sees — each proxy is painted with its unique encoded slot/instance
	 * color. Call `updateDebug()` each frame before rendering to keep transforms
	 * in sync.
	 * @returns {import('three/webgpu').Scene}
	 */
	get debugScene() {
		return this._pickScene
	}

	/**
	 * Sync the debug scene's proxy transforms to the current line positions.
	 * Call this each frame before rendering `debugScene` to the canvas.
	 */
	updateDebug() {
		this._syncProxies()
	}

	_pixelOrder( ts ) {
		if ( this._pixelOrderCache?.ts === ts ) return this._pixelOrderCache.order
		const center = Math.floor( ts / 2 )
		const order = []
		for ( let dy = -center; dy <= center; dy++ ) {
			for ( let dx = -center; dx <= center; dx++ ) {
				order.push( [dx, dy, dx * dx + dy * dy] )
			}
		}
		order.sort( ( a, b ) => a[ 2 ] - b[ 2 ] )
		const trimmed = order.map( ( [dx, dy] ) => [dx, dy] )
		this._pixelOrderCache = { ts, order: trimmed }
		return trimmed
	}

	/**
	 * Dispose the render target, picking materials, and registry.
	 */
	dispose() {
		if ( this._disposed ) return
		for ( const entry of this._registry.values() ) {
			this._pickScene.remove( entry.proxy )
			entry.material.dispose()
		}
		this._registry.clear()
		this._lineToSlot.clear()
		this._target.dispose()
		this._disposed = true
	}

}
