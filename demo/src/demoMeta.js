import { demoCatalog, demoSections } from './demoCatalog.js'

const demoModules = import.meta.glob( './demos/*.js' )

export const demoMeta = demoCatalog.map( demo => ( {
	...demo,
	load: demoModules[`./demos/${demo.sourceFile}`],
} ) )

// Menu order, which is also the previous / next order inside a demo.
export const menuDemoMeta = demoSections.flatMap( section => demoMeta.filter( demo => demo.section === section.id && !demo.hidden ) )

export const menuSections = demoSections.map( section => ( {
	...section,
	demos: menuDemoMeta.filter( demo => demo.section === section.id ),
} ) )

export const resolveDemoMeta = ( id ) => {
	return demoMeta.find( demo => demo.id === id || demo.aliases?.includes( id ) )
}
