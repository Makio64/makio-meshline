import { MeshLine } from 'makio-meshline'
import {
	AmbientLight,
	BackSide,
	DirectionalLight,
	Mesh,
	MeshStandardMaterial,
	PCFSoftShadowMap,
	SphereGeometry,
} from 'three'
import { color, mix, uv } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

class WireSculptureExample {
	constructor() {
		this.line = null
		this.lights = []
		this.ambientLight = null
		this.time = 0
		this.sculpture = null
		this.sphere = null
		this.background = null
	}

	async init() {
		await stage3d.initRender()

		stage3d.renderer.shadowMap.enabled = true
		stage3d.renderer.shadowMap.type = PCFSoftShadowMap

		stage3d.control = new OrbitControl( stage3d.camera, 10 )
		stage3d.control.maxRadius = 20
		stage3d.control.minRadius = 4
		stage3d.camera.position.set( 6, 4, 6 )

		this.initBackground()
		this.initLights()
		this.initSphere()
		this.createSculpture()

		stage.onUpdate.add( this.update )
	}

	initBackground() {
		const darkOrange = color( 0x8B4513 )
		const brightOrange = color( 0xFF8C00 )
		const gradientColor = mix( darkOrange, brightOrange, uv().y )

		const material = new MeshStandardNodeMaterial( {
			colorNode: gradientColor,
			side: BackSide
		} )

		const geometry = new SphereGeometry( 15, 32, 32 )
		this.background = new Mesh( geometry, material )
		this.background.receiveShadow = true
		stage3d.add( this.background )
	}

	initLights() {
		this.ambientLight = new AmbientLight( 0x404040, 0.5 )
		stage3d.add( this.ambientLight )

		const lightPositions = [
			[8, 10, 0],    // front
			[-4, 8, 7],    // back-left
			[-4, 8, -7]    // back-right
		]

		lightPositions.forEach( pos => {
			const light = new DirectionalLight( 0xffffff, 1.0 )
			light.position.set( pos[0], pos[1], pos[2] )
			light.castShadow = true

			light.shadow.mapSize.set( 2048, 2048 )
			light.shadow.camera.near = 0.5
			light.shadow.camera.far = 40
			light.shadow.bias = -0.0003
			light.shadow.radius = 2
			light.shadow.camera.left = -10
			light.shadow.camera.right = 10
			light.shadow.camera.top = 10
			light.shadow.camera.bottom = -10

			light.target.position.set( 0, 2.0, 0 )
			stage3d.add( light.target )
			stage3d.add( light )
			this.lights.push( light )
		} )
	}

	initSphere() {
		const geometry = new SphereGeometry( 1.5, 16, 16 )
		const material = new MeshStandardMaterial( {
			color: 0xffcc00,
			roughness: 0.9
		} )
		this.sphere = new Mesh( geometry, material )
		this.sphere.receiveShadow = true
		stage3d.add( this.sphere )
	}

	createSculpture() {
		// Torus knot (p=2, q=3) - more interesting than trefoil
		const segments = 600
		const points = new Float32Array( segments * 3 )

		const R = 2.5 // Major radius
		const r = 0.7 // Minor radius
		const p = 2 // Winds around torus
		const q = 3 // Winds through hole

		for ( let i = 0; i < segments; i++ ) {
			const t = ( i / segments ) * Math.PI * 2 * p

			// Torus knot parametric equations
			const angle = t * q / p
			const cosT = Math.cos( t )
			const sinT = Math.sin( t )
			const cosAngle = Math.cos( angle )
			const sinAngle = Math.sin( angle )

			const x = ( R + r * cosAngle ) * cosT
			const z = ( R + r * cosAngle ) * sinT
			const y = r * sinAngle 

			points[ i * 3 ] = x
			points[ i * 3 + 1 ] = y
			points[ i * 3 + 2 ] = z
		}

		this.line = new MeshLine()
		this.line.lines( points, true )
			.color( 0x222222 )
			.lineWidth( 0.12 )
			.dash( { count: 40, ratio: 0.4 } )
			.shadow( true )

		stage3d.add( this.line )
		this.sculpture = this.line
	}

	update = ( dt ) => {
		this.time += dt * 0.001

		// Slowly rotate the sculpture
		if ( this.sculpture ) {
			this.sculpture.rotation.x = this.time * 0.15
			// this.sculpture.rotation.y = this.time * 0.2
			// this.sculpture.rotation.z = this.time * 0.1
		}

		// Animate dashes
		if ( this.line && this.line.material.dashOffset ) {
			this.line.material.dashOffset.value -= dt * 0.002
		}
	}

	dispose() {
		stage.onUpdate.remove( this.update )

		if ( this.background ) {
			stage3d.remove( this.background )
			this.background.geometry.dispose()
			this.background.material.dispose()
			this.background = null
		}

		if ( this.sphere ) {
			stage3d.remove( this.sphere )
			this.sphere.geometry.dispose()
			this.sphere.material.dispose()
			this.sphere = null
		}

		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
			this.line = null
		}

		this.sculpture = null

		this.lights.forEach( light => {
			stage3d.remove( light.target )
			stage3d.remove( light )
		} )
		this.lights = []

		if ( this.ambientLight ) {
			stage3d.remove( this.ambientLight )
			this.ambientLight = null
		}

		stage3d.control?.dispose()
	}

	show() { }
	hide( cb ) { if ( cb ) cb() }
}

export default new WireSculptureExample()
