import { smoothstep } from "three/webgpu"
import oklab_mix from "./oklabmix"

export const gradient = ( colors, percents, percent ) => {
	if ( !percents ) percents = colors.map( ( _, i ) => i / ( colors.lenght - 1 ) )
	let col = colors[0]
	for ( let i = 1; i < colors.length; i++ ) {
		col = oklab_mix( [col, colors[i], smoothstep( percents[i - 1], percents[i], percent )] )
	}
	return col
}
