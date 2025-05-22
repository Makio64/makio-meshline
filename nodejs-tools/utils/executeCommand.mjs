import { exec as execCallback } from 'child_process'
import { promisify } from 'util'

const exec = promisify( execCallback )

export default async ( command ) => {
	try {
		const { stdout, stderr } = await exec( command )
		console.log( 'Output:', stdout )
		if ( stderr ) {
			console.error( 'Error:', stderr )
		}
	} catch ( error ) {
		console.error( 'Execution Error:', error )
	}
}
