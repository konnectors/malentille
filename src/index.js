const {
  BaseKonnector,
  requestFactory,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const moment = require('moment')

moment.locale('fr')
const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very usefull for
  // debugging but very verbose. That is why it is commented out by default
  // debug: true,
  // activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // this allows request-promise to keep cookies between requests
  jar: true
})

const vendor = 'Digital Eyewear'
const baseUrl = 'https://www.malentille.com/' // authentification?back=my-account'

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  var $ = await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of documents')
  $ = await request(`${baseUrl}historique-des-commandes`)
  // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)
  log('info', `Found ${documents.length} bills`)
  // here we use the saveBills function even if what we fetch are not bills, but this is the most
  // common case in connectors
  log('info', 'Saving data to Cozy')
  log('debug', documents)
  await saveBills(documents, fields.folderPath, {
    // this is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: [vendor] // FIXME
  })
}

// this shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
async function authenticate(username, password) {
  await request(baseUrl + 'authentification?back=my-account')
  return await request({
    method: 'POST',
    url: baseUrl + 'authentification',
    form: {
      back: 'history',
      email: username,
      passwd: password,
      SubmitLogin: 'Identifiez-vous'
    }
  })
}

// The goal of this function is to parse a html page wrapped by a cheerio instance
// and return an array of js objects which will be saved to the cozy by saveBills (https://github.com/cozy/cozy-konnector-libs/blob/master/docs/api.md#savebills)
function parseDocuments($) {
  // you can find documentation about the scrape function here :
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  const docs = scrape(
    $,
    {
      fileurl: {
        sel: '.history_invoice a',
        // index: 0,
        attr: 'href'
      },
      billNumber: {
        sel: '.history_invoice a',
        index: 1,
        fn: numberElem =>
          numberElem &&
          $(numberElem)
            .text()
            .match(/\d+/)[0]
      },
      date: {
        sel: '.history_date',
        parse: dateString => moment(dateString, 'DD/MM/YYYY')
      },
      amount: {
        sel: '.history_price',
        parse: amountString => normalizePrice(amountString)
      }
    },
    '#block-history tbody tr'
  )
  // console.log($('div#bloc-history tbody tr').text())
  return docs.map(doc => ({
    ...doc,
    date: doc.date.toDate(),
    // the saveBills function needs a date field
    // even if it is a little artificial here (these are not real bills)
    currency: '€',
    filename: `${vendor}_facture_${doc.date.toISOString().slice(0, 10)}_n_${
      doc.billNumber
    }.pdf`,
    vendor,
    metadata: {
      // it can be interesting that we add the date of import. This is not mandatory but may be
      // usefull for debugging or data migration
      importDate: new Date(),
      // document version, usefull for migration after change of document structure
      version: 1
    }
  }))
}

// convert a price string to a float
function normalizePrice(price) {
  return parseFloat(
    price
      .trim()
      .replace('€', '')
      .replace(',', '.')
  )
}
