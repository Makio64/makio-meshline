import { MeshLine } from 'makio-meshline'
import {
	AmbientLight,
	DirectionalLight,
	Mesh,
	MeshStandardMaterial,
	PlaneGeometry
} from 'three'
import { texture, textureLoad, vec2, textureSize, uv, vec3 } from 'three/tsl'
import { MeshBasicNodeMaterial, OrthographicCamera, Scene } from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

class EiffelTowerExample {
	constructor() {
		this.lines = []
		this.light = null
		this.ground = null
		this.ambientLight = null
		this.time = 0
		this.shadowMode = 'world'
		this.updateInstructionText()
		// Debug shadow map view
		this.debugScene = null
		this.debugCamera = null
		this.debugQuad = null
	}

	async init() {
		await stage3d.initRender()

		// Enable shadow maps on the renderer
		stage3d.renderer.shadowMap.enabled = true

		stage3d.control = new OrbitControl( stage3d.camera, 15 )
		stage3d.control.maxRadius = 30
		stage3d.control.minRadius = 5
		stage3d.camera.position.set( 8, 6, 8 )

		this.initLights()
		this.initGround()
		this.initTower()
		this.applyShadowMode( this.shadowMode )

		stage.onUpdate.add( this.update )
		stage.onRender.add( this.renderDebug )
		window.addEventListener( 'resize', this.onResize )
		window.addEventListener( 'keydown', this.onKeyDown )
		this.updateInstructionText()
	}

	initLights() {
		// Ambient light for base illumination
		this.ambientLight = new AmbientLight( 0x404040, 0.5 )
		stage3d.add( this.ambientLight )

		// Directional light that will orbit
		this.light = new DirectionalLight( 0xffffff, 2 )
		this.light.position.set( 10, 12, 10 )
		this.light.castShadow = true

		// Shadow configuration
		this.light.shadow.mapSize.set( 2048, 2048 )
		this.light.shadow.camera.near = 0.5
		this.light.shadow.camera.far = 50
		this.light.shadow.bias = -0.0005
		this.light.shadow.camera.left = -15
		this.light.shadow.camera.right = 15
		this.light.shadow.camera.top = 15
		this.light.shadow.camera.bottom = -15
		this.light.shadow.autoUpdate = false
		this.light.shadow.needsUpdate = true

		// Add light target to scene for proper tracking
		this.light.target.position.set( 0, 4, 0 )
		stage3d.add( this.light.target )
		stage3d.add( this.light )
	}

	initDebugView() {
		// Create separate scene for overlay
		this.debugScene = new Scene()

		// Orthographic camera in NDC space (-1 to 1)
		this.debugCamera = new OrthographicCamera( -1, 1, 1, -1, 0, 1 )

		// Create debug quad geometry
		const geometry = new PlaneGeometry( 0.4, 0.4 )

		// Sample shadow map depth - exact approach from Three.js ShadowNode.js line 533
		const material = new MeshBasicNodeMaterial()
		const depthTex = this.light.shadow.map.depthTexture
		const texSize = textureSize( texture( depthTex ) )
		// textureLoad needs integer coords - multiply UV by size
		const depth = textureLoad( depthTex, uv().mul( texSize ) ).x.oneMinus()
		material.colorNode = vec3( depth )

		this.debugQuad = new Mesh( geometry, material )
		this.debugQuad.position.set( -0.75, -0.75, 0 )
		this.debugScene.add( this.debugQuad )
	}

	initGround() {
		const geometry = new PlaneGeometry( 30, 30 )
		const material = new MeshStandardMaterial( { color: 0x333333 } )
		this.ground = new Mesh( geometry, material )
		this.ground.rotation.x = -Math.PI / 2
		this.ground.position.y = 0
		this.ground.receiveShadow = true
		stage3d.add( this.ground )
	}

	initTower() {
		// Tower dimensions
		this.towerHeight = 8
		this.baseWidth = 2.8

		// French tricolor - Bleu Blanc Rouge
		this.colors = {
			bleu: 0x002395,
			blanc: 0xffffff,
			rouge: 0xed2939
		}

		// Platform heights (normalized 0-1)
		this.platforms = {
			ground: 0,
			first: 0.18,
			second: 0.40,
			top: 0.85
		}

		// Corner angles for square footprint
		this.corners = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]

		// Build the tower
		this.createLegs()
		this.createArches()
		this.createPlatforms()
		this.createDiagonalBracing()
		this.createVerticalSupports()
		this.createLatticeFill()
		this.createSpire()
	}

	// Get color based on normalized height (0-1) - Bleu Blanc Rouge
	getColorForHeight( t ) {
		if ( t < 0.33 ) return this.colors.bleu
		if ( t < 0.66 ) return this.colors.blanc
		return this.colors.rouge
	}

	// Get radius at normalized height t
	getRadius( t ) {
		if ( t <= this.platforms.second ) {
			// Exponential curve for lower section
			const k = 2.5
			return this.baseWidth * Math.exp( -k * t )
		}
		// Linear taper for upper shaft
		const r2 = this.baseWidth * Math.exp( -2.5 * this.platforms.second )
		const topR = 0.25
		const tNorm = ( t - this.platforms.second ) / ( 1 - this.platforms.second )
		return r2 * ( 1 - tNorm ) + topR * tNorm
	}

	// Get position at corner and height
	getCornerPos( cornerIdx, t ) {
		const angle = this.corners[ cornerIdx ]
		const r = this.getRadius( t )
		return {
			x: Math.cos( angle ) * r,
			y: t * this.towerHeight,
			z: Math.sin( angle ) * r
		}
	}

	// Helper to add a line with height-based French tricolor
	addLine( positions, width, heightT = 0.5, closed = false ) {
		const color = this.getColorForHeight( heightT )
		const line = new MeshLine()
			.lines( positions, closed )
			.color( color )
			.lineWidth( width )
			.worldUnits( true )
			.shadowMode( this.shadowMode )
			
		// Enable world-space width for shadow support
		// MeshLine now shares its thick-line vertex transform with the shadow pass,
		// so enabling castShadow projects accurate ribbon shadows on the ground plane.
		line.castShadow = true
		stage3d.add( line )
		this.lines.push( line )
	}

	createLegs() {
		const segmentsPerBand = 27
		const colorBands = [
			{ start: 0, end: 0.33 },
			{ start: 0.33, end: 0.66 },
			{ start: 0.66, end: 1.0 }
		]

		// Four main legs - outer edge, split by color bands
		for ( let leg = 0; leg < 4; leg++ ) {
			for ( const band of colorBands ) {
				const positions = new Float32Array( ( segmentsPerBand + 1 ) * 3 )

				for ( let i = 0; i <= segmentsPerBand; i++ ) {
					const t = band.start + ( band.end - band.start ) * ( i / segmentsPerBand )
					const pos = this.getCornerPos( leg, t )
					positions[ i * 3 ] = pos.x
					positions[ i * 3 + 1 ] = pos.y
					positions[ i * 3 + 2 ] = pos.z
				}

				const midT = ( band.start + band.end ) / 2
				this.addLine( positions, 0.12, midT )
			}
		}

		// Inner edge of legs (creates thickness)
		const innerScale = 0.85
		for ( let leg = 0; leg < 4; leg++ ) {
			const angle = this.corners[ leg ]

			for ( const band of colorBands ) {
				const positions = new Float32Array( ( segmentsPerBand + 1 ) * 3 )

				for ( let i = 0; i <= segmentsPerBand; i++ ) {
					const t = band.start + ( band.end - band.start ) * ( i / segmentsPerBand )
					const r = this.getRadius( t ) * innerScale
					positions[ i * 3 ] = Math.cos( angle ) * r
					positions[ i * 3 + 1 ] = t * this.towerHeight
					positions[ i * 3 + 2 ] = Math.sin( angle ) * r
				}

				const midT = ( band.start + band.end ) / 2
				this.addLine( positions, 0.08, midT )
			}
		}
	}

	createArches() {
		const segments = 24
		const archHeight = this.platforms.first * this.towerHeight

		// Create arch between each pair of adjacent legs
		for ( let i = 0; i < 4; i++ ) {
			const next = ( i + 1 ) % 4
			const p1 = this.getCornerPos( i, 0 )
			const p2 = this.getCornerPos( next, 0 )

			const positions = new Float32Array( ( segments + 1 ) * 3 )

			for ( let j = 0; j <= segments; j++ ) {
				const t = j / segments
				// Parabolic arch
				const archT = 4 * t * ( 1 - t ) // 0->1->0
				const x = p1.x * ( 1 - t ) + p2.x * t
				const z = p1.z * ( 1 - t ) + p2.z * t
				const y = archT * archHeight * 0.95

				positions[ j * 3 ] = x
				positions[ j * 3 + 1 ] = y
				positions[ j * 3 + 2 ] = z
			}

			this.addLine( positions, 0.10, this.platforms.first * 0.5 )
		}

		// Inner decorative arches (smaller)
		const innerArchScale = 0.7
		for ( let i = 0; i < 4; i++ ) {
			const next = ( i + 1 ) % 4
			const p1 = this.getCornerPos( i, 0 )
			const p2 = this.getCornerPos( next, 0 )

			const positions = new Float32Array( ( segments + 1 ) * 3 )

			for ( let j = 0; j <= segments; j++ ) {
				const t = j / segments
				const archT = 4 * t * ( 1 - t )
				const x = ( p1.x * ( 1 - t ) + p2.x * t ) * innerArchScale
				const z = ( p1.z * ( 1 - t ) + p2.z * t ) * innerArchScale
				const y = archT * archHeight * 0.6

				positions[ j * 3 ] = x
				positions[ j * 3 + 1 ] = y
				positions[ j * 3 + 2 ] = z
			}

			this.addLine( positions, 0.05, this.platforms.first * 0.3 )
		}
	}

	createPlatforms() {
		const levels = [this.platforms.first, this.platforms.second, this.platforms.top]
		const widths = [0.10, 0.10, 0.08]

		levels.forEach( ( t, idx ) => {
			// Square platform ring
			const positions = new Float32Array( 15 ) // 5 points for closed square

			for ( let i = 0; i <= 4; i++ ) {
				const corner = i % 4
				const pos = this.getCornerPos( corner, t )
				positions[ i * 3 ] = pos.x
				positions[ i * 3 + 1 ] = pos.y
				positions[ i * 3 + 2 ] = pos.z
			}

			this.addLine( positions, widths[ idx ], t )

			// Inner ring for platforms (creates depth)
			const innerPositions = new Float32Array( 15 )
			const innerScale = 0.8

			for ( let i = 0; i <= 4; i++ ) {
				const corner = i % 4
				const pos = this.getCornerPos( corner, t )
				innerPositions[ i * 3 ] = pos.x * innerScale
				innerPositions[ i * 3 + 1 ] = pos.y
				innerPositions[ i * 3 + 2 ] = pos.z * innerScale
			}

			this.addLine( innerPositions, widths[ idx ] * 0.6, t )
		} )
	}

	createDiagonalBracing() {
		const sections = [
			{ from: this.platforms.ground, to: this.platforms.first, rows: 3 },
			{ from: this.platforms.first, to: this.platforms.second, rows: 3 },
			{ from: this.platforms.second, to: this.platforms.top, rows: 4 }
		]

		sections.forEach( section => {
			const { from, to, rows } = section

			for ( let row = 0; row < rows; row++ ) {
				const t1 = from + ( to - from ) * ( row / rows )
				const t2 = from + ( to - from ) * ( ( row + 1 ) / rows )
				const midT = ( t1 + t2 ) / 2

				// X-bracing on each face
				for ( let face = 0; face < 4; face++ ) {
					const next = ( face + 1 ) % 4

					const bl = this.getCornerPos( face, t1 )
					const br = this.getCornerPos( next, t1 )
					const tl = this.getCornerPos( face, t2 )
					const tr = this.getCornerPos( next, t2 )

					// Diagonal 1
					const d1 = new Float32Array( 6 )
					d1[ 0 ] = bl.x; d1[ 1 ] = bl.y; d1[ 2 ] = bl.z
					d1[ 3 ] = tr.x; d1[ 4 ] = tr.y; d1[ 5 ] = tr.z
					this.addLine( d1, 0.04, midT )

					// Diagonal 2
					const d2 = new Float32Array( 6 )
					d2[ 0 ] = br.x; d2[ 1 ] = br.y; d2[ 2 ] = br.z
					d2[ 3 ] = tl.x; d2[ 4 ] = tl.y; d2[ 5 ] = tl.z
					this.addLine( d2, 0.04, midT )
				}
			}
		} )
	}

	createVerticalSupports() {
		const segmentsPerBand = 14
		const colorBands = [
			{ start: 0, end: 0.33 },
			{ start: 0.33, end: this.platforms.second }
		]

		// Mid-face vertical supports (between corners) - split by color
		for ( let face = 0; face < 4; face++ ) {
			const next = ( face + 1 ) % 4
			const midAngle = ( this.corners[ face ] + this.corners[ next ] ) / 2

			for ( const band of colorBands ) {
				const positions = new Float32Array( ( segmentsPerBand + 1 ) * 3 )

				for ( let i = 0; i <= segmentsPerBand; i++ ) {
					const t = band.start + ( band.end - band.start ) * ( i / segmentsPerBand )
					const r = this.getRadius( t ) * 0.95
					positions[ i * 3 ] = Math.cos( midAngle ) * r
					positions[ i * 3 + 1 ] = t * this.towerHeight
					positions[ i * 3 + 2 ] = Math.sin( midAngle ) * r
				}

				const midT = ( band.start + band.end ) / 2
				this.addLine( positions, 0.06, midT )
			}
		}

		// Leg connectors at each platform
		const connectLevels = [this.platforms.first, this.platforms.second]

		connectLevels.forEach( t => {
			for ( let corner = 0; corner < 4; corner++ ) {
				const outer = this.getCornerPos( corner, t )
				const innerR = this.getRadius( t ) * 0.8
				const angle = this.corners[ corner ]

				const positions = new Float32Array( 6 )
				positions[ 0 ] = outer.x
				positions[ 1 ] = outer.y
				positions[ 2 ] = outer.z
				positions[ 3 ] = Math.cos( angle ) * innerR
				positions[ 4 ] = outer.y
				positions[ 5 ] = Math.sin( angle ) * innerR

				this.addLine( positions, 0.05, t )
			}
		} )
	}

	createLatticeFill() {
		// Horizontal lattice lines between bracing rows
		const sections = [
			{ from: this.platforms.ground, to: this.platforms.first, count: 6 },
			{ from: this.platforms.first, to: this.platforms.second, count: 5 },
			{ from: this.platforms.second, to: this.platforms.top, count: 8 }
		]

		sections.forEach( section => {
			const { from, to, count } = section

			for ( let i = 1; i < count; i++ ) {
				const t = from + ( to - from ) * ( i / count )

				// Square ring at this height
				for ( let face = 0; face < 4; face++ ) {
					const next = ( face + 1 ) % 4
					const p1 = this.getCornerPos( face, t )
					const p2 = this.getCornerPos( next, t )

					const positions = new Float32Array( 6 )
					positions[ 0 ] = p1.x
					positions[ 1 ] = p1.y
					positions[ 2 ] = p1.z
					positions[ 3 ] = p2.x
					positions[ 4 ] = p2.y
					positions[ 5 ] = p2.z

					this.addLine( positions, 0.025, t )
				}
			}
		} )

		// Fine diagonal lattice in lower section
		const fineRows = 5
		for ( let row = 0; row < fineRows; row++ ) {
			const t1 = this.platforms.ground + ( this.platforms.first - this.platforms.ground ) * ( row / fineRows )
			const t2 = this.platforms.ground + ( this.platforms.first - this.platforms.ground ) * ( ( row + 0.5 ) / fineRows )
			const midT = ( t1 + t2 ) / 2

			for ( let face = 0; face < 4; face++ ) {
				const next = ( face + 1 ) % 4
				const midAngle = ( this.corners[ face ] + this.corners[ next ] ) / 2

				// Small diagonals from corner to mid-face
				const corner1 = this.getCornerPos( face, t1 )
				const r2 = this.getRadius( t2 ) * 0.95

				const positions = new Float32Array( 6 )
				positions[ 0 ] = corner1.x
				positions[ 1 ] = corner1.y
				positions[ 2 ] = corner1.z
				positions[ 3 ] = Math.cos( midAngle ) * r2
				positions[ 4 ] = t2 * this.towerHeight
				positions[ 5 ] = Math.sin( midAngle ) * r2

				this.addLine( positions, 0.02, midT )
			}
		}
	}

	createSpire() {
		const spireBase = this.platforms.top * this.towerHeight
		const spireTop = this.towerHeight * 1.1
		const baseR = this.getRadius( this.platforms.top )

		// Main spire - at the top, so rouge
		const mainSpire = new Float32Array( 6 )
		mainSpire[ 0 ] = 0
		mainSpire[ 1 ] = spireBase
		mainSpire[ 2 ] = 0
		mainSpire[ 3 ] = 0
		mainSpire[ 4 ] = spireTop
		mainSpire[ 5 ] = 0
		this.addLine( mainSpire, 0.08, 0.95 )

		// Supporting struts from corners to spire
		for ( let i = 0; i < 4; i++ ) {
			const pos = this.getCornerPos( i, this.platforms.top )
			const strutTop = spireBase + ( spireTop - spireBase ) * 0.4

			const positions = new Float32Array( 6 )
			positions[ 0 ] = pos.x
			positions[ 1 ] = pos.y
			positions[ 2 ] = pos.z
			positions[ 3 ] = 0
			positions[ 4 ] = strutTop
			positions[ 5 ] = 0

			this.addLine( positions, 0.04, this.platforms.top )
		}

		// Upper ring around spire
		const ringHeight = spireBase + ( spireTop - spireBase ) * 0.3
		const ringR = baseR * 0.5
		const ringPositions = new Float32Array( 15 )

		for ( let i = 0; i <= 4; i++ ) {
			const angle = this.corners[ i % 4 ]
			ringPositions[ i * 3 ] = Math.cos( angle ) * ringR
			ringPositions[ i * 3 + 1 ] = ringHeight
			ringPositions[ i * 3 + 2 ] = Math.sin( angle ) * ringR
		}

		this.addLine( ringPositions, 0.04, 0.9 )
	}

	update = ( dt ) => {
		this.time += dt * 0.001

		// Orbit the light around the tower
		const radius = 15
		this.light.position.x = Math.cos( this.time * 0.5 ) * radius
		this.light.position.z = Math.sin( this.time * 0.5 ) * radius
		this.light.position.y = 10

		// Manually update shadow map since autoUpdate is disabled
		this.light.shadow.needsUpdate = true
	}

	renderDebug = () => {
		// Initialize debug view once shadow map is available
		if ( !this.debugScene && this.light.shadow.map ) {
			this.initDebugView()
		}

		// Render debug overlay
		if ( this.debugScene ) {
			stage3d.renderer.autoClear = false
			stage3d.renderer.render( this.debugScene, this.debugCamera )
			stage3d.renderer.autoClear = true
		}
	}

	onResize = () => {
		this.lines.forEach( line => line.resize() )
	}

	updateInstructionText() {
		this.text = `Shadow casting: [1] clip space / [2] world space — Current: ${this.shadowMode?.toUpperCase?.() || 'CLIP'}`
	}

	applyShadowMode = ( mode ) => {
		const normalized = mode === 'world' ? 'world' : 'clip'
		if ( this.shadowMode === normalized ) {
			return
		}
		this.shadowMode = normalized
		this.lines.forEach( line => {
			if ( typeof line.shadowMode === 'function' ) {
				line.shadowMode( normalized )
			} else if ( line.material?.setShadowMode ) {
				line.material.setShadowMode( normalized )
			}
		} )
		if ( this.light?.shadow ) {
			this.light.shadow.needsUpdate = true
		}
		this.updateInstructionText()
		console.log( `[MeshLine] Shadow mode switched to ${normalized}` )
	}

	onKeyDown = ( event ) => {
		if ( event.key === '1' ) {
			this.applyShadowMode( 'clip' )
		} else if ( event.key === '2' ) {
			this.applyShadowMode( 'world' )
		}
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		stage.onRender.remove( this.renderDebug )
		window.removeEventListener( 'resize', this.onResize )
		window.removeEventListener( 'keydown', this.onKeyDown )

		this.lines.forEach( line => {
			stage3d.remove( line )
			line.dispose()
		} )
		this.lines = []

		if ( this.ground ) {
			stage3d.remove( this.ground )
			this.ground.geometry.dispose()
			this.ground.material.dispose()
			this.ground = null
		}

		if ( this.light ) {
			stage3d.remove( this.light.target )
			stage3d.remove( this.light )
			this.light = null
		}

		if ( this.ambientLight ) {
			stage3d.remove( this.ambientLight )
			this.ambientLight = null
		}

		// Clean up debug view
		if ( this.debugQuad ) {
			this.debugScene.remove( this.debugQuad )
			this.debugQuad.geometry.dispose()
			this.debugQuad.material.dispose()
			this.debugQuad = null
		}
		this.debugScene = null
		this.debugCamera = null

		stage3d.control?.dispose()
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new EiffelTowerExample()
