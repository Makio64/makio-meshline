import * as THREE from 'three/webgpu'
import MeshLine from './src/MeshLine.js'

async function run() {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 5, 20)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    // Using count = 2 to trigger isInstanced = true
    const line = new MeshLine()
        .instances( 2 )
        .lineWidth( 0.04 )
        .build()
        
    line.addInstanceAttribute( 'instanceStart', 3 )
    line.addInstanceAttribute( 'instanceEnd', 3 )
    line.setInstanceValue( 'instanceStart', 0, [-5, 0, 0] )
    line.setInstanceValue( 'instanceEnd', 0, [5, 0, 0] )
    line.setInstanceValue( 'instanceStart', 1, [-5, 5, 0] )
    line.setInstanceValue( 'instanceEnd', 1, [5, 5, 0] )

    scene.add(line)
    scene.updateMatrixWorld(true)

    const raycaster = new THREE.Raycaster()
    raycaster.params.Line.threshold = 0.3
    
    // Convert 0,0,0 to screen coords to test raycast (should hit instance 0)
    const center = new THREE.Vector3(0, 0, 0)
    center.project(camera)
    
    raycaster.setFromCamera(new THREE.Vector2(center.x, center.y), camera)
    
    const intersects = raycaster.intersectObject(line)
    console.log("Intersecting center (should be 1 hit):", intersects.length)

    // Raycast a bit off
    raycaster.setFromCamera(new THREE.Vector2(center.x + 0.1, center.y), camera)
    console.log("Intersecting slightly off:", raycaster.intersectObject(line).length)
}
run().catch(console.error)
