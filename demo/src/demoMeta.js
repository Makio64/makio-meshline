import { demoCatalog } from './demoCatalog.js'

const demoModules = import.meta.glob( './demos/*.js' )

export const demoMeta = demoCatalog.map( demo => ( {
	...demo,
	load: demoModules[`./demos/${demo.sourceFile}`],
} ) )

export const basicDemoMeta = demoMeta.filter( demo => demo.group === 'basic' )
export const advancedDemoMeta = demoMeta.filter( demo => demo.group === 'advanced' )

export const resolveDemoMeta = ( id ) => {
	return demoMeta.find( demo => demo.id === id || demo.aliases?.includes( id ) )
}
