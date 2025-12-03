import { circlePositions, MeshLine } from 'makio-meshline'
import {
	AmbientLight,
	BackSide,
	Mesh,
	MeshStandardMaterial,
	PCFSoftShadowMap,
	SphereGeometry,
	SpotLight,
	SpotLightHelper,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

class WireSculptureExample {
	constructor() {
		this.lines = []
		this.lights = []
		this.lightHelpers = []
		this.lightConfigs = []
		this.ambientLight = null
		this.time = 0
		this.sphere = null
		this.background = null
		this.disposed = false
	}

	async init() {
		this.disposed = false
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

		const material = new MeshStandardNodeMaterial( {
			side: BackSide
		} )

		const geometry = new SphereGeometry( 8, 16, 16 )
		this.background = new Mesh( geometry, material )
		this.background.receiveShadow = true
		stage3d.add( this.background )
	}

	initLights() {
		this.ambientLight = new AmbientLight( 0x606060, 0.8 )
		stage3d.add( this.ambientLight )

		// Spherical orbit config: radius, phi/theta speeds and offsets
		const lightConfigs = [
			{ radius: 10, phiSpeed: 0.2, thetaSpeed: 0.3, phiOffset: 0, thetaOffset: 0, phiAmp: 0.3 },
			{ radius: 9, phiSpeed: 0.35, thetaSpeed: 0.5, phiOffset: Math.PI * 0.5, thetaOffset: Math.PI * 2 / 3, phiAmp: 0.4 },
			{ radius: 8, phiSpeed: 0.5, thetaSpeed: 0.7, phiOffset: Math.PI, thetaOffset: Math.PI * 4 / 3, phiAmp: 0.5 }
		]

		this.lightConfigs = lightConfigs

		const colors = [0xff6666, 0x66ff66, 0x6666ff]

		lightConfigs.forEach( ( config, i ) => {
			const light = new SpotLight( colors[i], 15 )
			light.angle = Math.PI / 4
			light.penumbra = 0.8
			light.decay = 1.5
			light.castShadow = true

			light.shadow.mapSize.set( 1024, 1024 )
			light.shadow.camera.near = 0.5
			light.shadow.camera.far = 40
			light.shadow.bias = -0.0003
			light.shadow.radius = 5

			light.target.position.set( 0, 0, 0 )
			stage3d.add( light.target )
			stage3d.add( light )
			this.lights.push( light )

			const helper = new SpotLightHelper( light, colors[i] )
			stage3d.add( helper )
			this.lightHelpers.push( helper )
		} )
	}

	initSphere() {
		const geometry = new SphereGeometry( 1.5, 16, 16 )
		const material = new MeshStandardMaterial( {
			color: 0xffffff,
			roughness: 0.9
		} )
		this.sphere = new Mesh( geometry, material )
		this.sphere.receiveShadow = true
		stage3d.add( this.sphere )
	}

	createSculpture() {
		const circleConfigs = [
			{ radius: 2.5, dashCount: 30, dashRatio: 0.5, color: 0x222222, width: 0.1 },
			{ radius: 3.5, dashCount: 45, dashRatio: 0.4, color: 0x333333, width: 0.08 }
		]

		circleConfigs.forEach( config => {
			const points = circlePositions( 200, config.radius )

			const line = new MeshLine()
			line.lines( points, true )
				.color( config.color )
				.lineWidth( config.width )
				.dash( { count: config.dashCount, ratio: config.dashRatio } )
				.shadow( true )

			stage3d.add( line )
			this.lines.push( line )
		} )
	}

	update = ( dt ) => {
		if ( this.disposed ) return
		this.time += dt * 0.001

		// Rotate and animate circles
		this.lines.forEach( ( line, i ) => {
			line.rotation.x = this.time * ( 0.15 + i * 0.1 )
			line.rotation.y = this.time * ( 0.1 + i * 0.05 )

			if ( line.material.dashOffset ) {
				line.material.dashOffset.value -= dt * ( 0.001 + i * 0.0005 )
			}
		} )

		// Orbit spotlights using spherical coordinates
		this.lights.forEach( ( light, i ) => {
			const config = this.lightConfigs[i]
			if ( !config ) return
			// Phi oscillates up/down, theta rotates around
			const phi = Math.PI * 0.3 + Math.sin( this.time * config.phiSpeed + config.phiOffset ) * config.phiAmp
			const theta = this.time * config.thetaSpeed + config.thetaOffset

			// Spherical to cartesian
			light.position.x = config.radius * Math.sin( phi ) * Math.cos( theta )
			light.position.y = config.radius * Math.cos( phi )
			light.position.z = config.radius * Math.sin( phi ) * Math.sin( theta )

			// Update helper
			this.lightHelpers[i]?.update()
		} )
	}

	dispose() {
		this.disposed = true
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

		this.lines.forEach( line => {
			stage3d.remove( line )
			line.dispose()
		} )
		this.lines = []

		this.lightHelpers.forEach( helper => {
			helper.parent?.remove( helper )
			helper.dispose()
		} )
		this.lightHelpers = []

		this.lights.forEach( light => {
			light.target.parent?.remove( light.target )
			light.parent?.remove( light )
			light.shadow.map?.dispose()
			light.dispose()
		} )
		this.lights = []
		this.lightConfigs = []

		if ( this.ambientLight ) {
			stage3d.remove( this.ambientLight )
			this.ambientLight.dispose()
			this.ambientLight = null
		}

		stage3d.renderer.shadowMap.enabled = false
		stage3d.control?.dispose()
	}

	show() { }
	hide( cb ) { if ( cb ) cb() }
}

export default new WireSculptureExample()
