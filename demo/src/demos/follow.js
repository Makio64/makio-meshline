import { Vector3, MathUtils } from 'three/webgpu'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import { MeshLine } from 'meshline'

const NUM_POINTS = 20
const LERP_FACTOR = 0.35 // smoothness of the follow behaviour

class FollowExample {
	constructor() {
		this.points = Array.from( { length: NUM_POINTS }, () => new Vector3() )
		this.line = null
		this.target = new Vector3()
		this.prevTarget = new Vector3()
		this.time = 0
		this.dpr = window.devicePixelRatio || 1

		this.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0
		this.autoMode = this.isMobile // use virtual mouse until real interaction happens
	}

	// -------------------------------------------------- INIT
	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		this.initLine()
		this.addEvents()
	}

	initLine() {
		const lineOptions = {
			lines: this._pointsToFloat32(),
			lineWidth: 0.2,
			isClose: false,
			gradientColor: 0x00ff00,
			needsWidth: true,
			widthCallback: ( t ) => {
				const edge = 0.1
				if ( t < edge ) return MathUtils.lerp( 0.1, 1, t / edge )
				if ( t > 1 - edge ) return MathUtils.lerp( 0.1, 1, ( 1 - t ) / edge )
				return 1 // full width in the middle
			},
		}
		this.line = new MeshLine( lineOptions )
		stage3d.add( this.line )

		// Keep line resolution in sync
		window.addEventListener( 'resize', this._onResize )
		stage.onUpdate.add( this.update )
	}

	addEvents() {
		// Desktop mouse
		window.addEventListener( 'mousemove', ( e ) => {
			this.autoMode = false
			this.target.copy( this._screenToWorld( e.clientX, e.clientY ) )
		} )

		// Touch devices
		window.addEventListener( 'touchmove', ( e ) => {
			if ( e.touches.length === 0 ) return
			this.autoMode = false
			const t = e.touches[0]
			this.target.copy( this._screenToWorld( t.clientX, t.clientY ) )
		}, { passive: true } )
	}

	// -------------------------------------------------- UPDATE LOOP
	update = ( dt ) => {
		this.time += dt

		// Auto (virtual) mouse path for mobile / when no interaction
		if ( this.autoMode ) {
			const t = this.time * 0.0006
			const radius = 3.5
			this.target.set( Math.cos( t ) * radius, Math.sin( t ) * radius, 0 )
		}

		// First point heads towards the target
		this.points[0].lerp( this.target, LERP_FACTOR )

		// Each subsequent point chases the previous one
		for ( let i = 1; i < NUM_POINTS; i++ ) {
			this.points[i].lerp( this.points[i - 1], LERP_FACTOR )
		}

		// Update MeshLine geometry
		this.line.geometry.setLines( this._pointsToFloat32() )

		// ------------------------------------------------ width based on mouse speed
		const speed = this.target.distanceTo( this.prevTarget ) / ( dt || 1 ) // world units per ms
		const targetWidth = MathUtils.clamp( 0.001 + speed * 5, 0.15, 2 ) * this.dpr
		// Smooth interpolation to avoid jitter
		this.line.material.lineWidth.value = MathUtils.lerp( this.line.material.lineWidth.value, targetWidth, 0.15 )
		this.prevTarget.copy( this.target )
	}

	// -------------------------------------------------- HELPERS
	_pointsToFloat32() {
		const arr = new Float32Array( NUM_POINTS * 3 )
		for ( let i = 0; i < NUM_POINTS; i++ ) {
			const p = this.points[i]
			arr[i * 3] = p.x
			arr[i * 3 + 1] = p.y
			arr[i * 3 + 2] = p.z
		}
		return arr
	}

	_screenToWorld( x, y ) {
		const ndcX = ( x / stage.width ) * 2 - 1
		const ndcY = - ( y / stage.height ) * 2 + 1
		const vec = new Vector3( ndcX, ndcY, 0.5 )
		vec.unproject( stage3d.camera )
		const dir = vec.sub( stage3d.camera.position ).normalize()
		const distance = -stage3d.camera.position.z / dir.z
		return stage3d.camera.position.clone().add( dir.multiplyScalar( distance ) )
	}

	_onResize = () => {
		this.line?.resize()
	}

	// -------------------------------------------------- CLEANUP
	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this._onResize )
		stage3d.remove( this.line )
		this.line?.dispose()
		this.line = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new FollowExample() 