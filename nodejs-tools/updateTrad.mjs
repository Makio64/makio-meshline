import Airtable from 'airtable'
import fs from 'fs'
import sortJSONAlphabetically from './utils/sortJSONAlphabetically.mjs'
import dotenv from 'dotenv'

dotenv.config()

// Your airtable base must have this columns : key | EN | FR | (or other langs)
const LANGS = ['en', 'fr']
const TABLES = ['translation'] // name of the tables in airtable
const APIKEY = process.env.AIRTABLE_API_KEY // keyXXXXXXXXXXXXXXX
const BASEID = process.env.AIRTABLE_BASE_ID // appXXXXXXXXXXXXXXX

const base = new Airtable( { apiKey: APIKEY } ).base( BASEID )

const jsons = {}
for ( const l of LANGS ) {
	jsons[l] = {}
}

for ( const table of TABLES ) {
	const subtitles = []

	base( table )
		.select( {
			maxRecords: 100000000,
			view: 'Grid view',
		} )
		.eachPage(
			function page( records, fetchNextPage ) {
				records.forEach( function ( record ) {
					const key = record.get( 'key' )
					if ( key != undefined ) {
						if ( jsons[LANGS[0]][key] == undefined ) {
							for ( const l of LANGS ) {
								jsons[l][key] = record.get( l.toUpperCase() ) || ''
							}
						} else {
							console.warn( 'duplicate on', key )
						}
					}
				} )
				fetchNextPage()
			},
			function done( err ) {
				if ( err ) {
					console.error( err )
					return
				}

				for ( const l of LANGS ) {
					jsons[l] = sortJSONAlphabetically( jsons[l] )
					fs.writeFile( `./public/translations/${l}.json`, JSON.stringify( jsons[l], null, 4 ), function ( err ) {
						if ( err ) return console.log( err )
						else console.log( `airtable : Translations ${l.toUpperCase()} update with success!` )
					} )
				}
			},
		)
}
