import { text2canvas } from "@/makio/utils/img/text2canvas"
import { Texture } from "three"
import stage3d from "../stage3d"

export async function text2texture( text, options = { fontFamily = 'Helvetica', weight = 400, fontSize = 256, margin = 20, color = 'white' } = {} ) {
	let { canvas } = await text2canvas( text, options )
	let texture = new Texture( canvas )
	texture.needsUpdate = true
	texture.anisotropy = stage3d.renderer.getMaxAnisotropy()
	// for debug
	// canvas.style.position = 'absolute'
	// canvas.style.top = '0px'
	// canvas.style.left = '0px'
	// canvas.style.zIndex = 1000000
	// canvas.style.transform = 'translate(-25%, -25%) scale(.5)'

	document.body.appendChild( canvas )
	let ratio = canvas.width / canvas.height
	texture.metaData = { width: canvas.width, height: canvas.height, canvas, ratio }

	return texture
}

export default text2texture
