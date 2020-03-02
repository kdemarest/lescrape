const fs = require('fs');
const csv = require('fast-csv');
const prompt = require('prompt');
const Nightmare = require('nightmare');

// Setup prompt attributes
let prompt_attrs = [
  { 
    name: 'email', 
    required: true, 
    message: "LinkedIn email" 
  },
  { 
    name: 'password', 
    hidden: true, 
    required: true, 
    message: "LinkedIn password" 
  },
  { 
    name: 'searchInterval', 
    default: "2000",
    message: "Wait interval between each connection search (in ms)" 
  },
  {
    name: 'showNightmare',
    default: "no",
    message: "Show email extraction process? (yes/no)"
  }
]

const emailFileName = 'Emails.json';

function writeEmails(data) {
  fs.writeFile(emailFileName, JSON.stringify(data,null,4), function(err) { 
    if (err) throw err;
  });
}

async function loadEmails() {
  return new Promise( (resolve,reject) => {
    let emails = {};
    if( fs.existsSync(emailFileName) ) {
      console.log('Reading Emails.json');
      emails = JSON.parse(fs.readFileSync(emailFileName, 'utf8'));
      console.log('Found',Object.values(emails).length,'existing names');
    }

    // Get connection names from connections.csv
    console.log('Reading Connections.csv');
    let insertCount = 0;
    let stream = fs.createReadStream("Connections.csv");
    csv
    .fromStream(stream, {headers : true})
    .on("data", function(data){
      let name = data['First Name'].trim()+' '+data['Last Name'].trim();
      name = name.trim();
      if( !emails[name] ) {
        console.log('New person',name,emails[name]);
        emails[name] = {
          name: name,
          first: data['First Name'].trim(),
          email: data['Email Address'].trim(),
        }
        ++insertCount;
      }
      emails[name].position = emails[name].position || data['Position'].trim();
      emails[name].connected = emails[name].connected || data['Connected On'].trim();
      emails[name].company = emails[name].company || data['Company'].trim();
      emails[name].history = emails[name].history || '';
    })
    .on("end", function(){
      if( insertCount>0 ) {
        console.log('Inserted',insertCount,'names');
      }
      console.log('Missing',Object.values(emails).filter(person=>person.email==='').length,'emails of ',Object.values(emails).length);
      return resolve(emails);
    });
  });
}


// This function starts the process by asking user for LinkedIn credentials, as well config options
// - email & password are used to log in to linkedin
async function readParams() {
  return new Promise( (resolve,reject) => {
    if( fs.existsSync('config.json') ) {
      let result = JSON.parse(fs.readFileSync('config.json', 'utf8'));
      return resolve(result);
    }
    prompt.start()
    prompt.get(prompt_attrs, (err, result) => {
      if( err ) throw(err);
      params.showNightmare = params.showNightmare === "yes";
      params.searchInterval = parseInt(params.searchInterval);
      return resolve(result);
    })
  });
}

function findFirstBlank(list,key) {
  let result = Object.values(list).filter( person => !person[key]/* || (Array.isArray(person[key]) && person[key].length==0)*/ );
  let found = result.length <= 0 ? null : result[0];
  //console.log(found);
  return found;
}

// Initial email extraction procedure
// Logs in to linked in and runs the getEmail async function to actually extract the emails
async function login(nightmare, email, password) {
  console.log('Login as',email);
  try {
    await nightmare
    .goto('https://www.linkedin.com/login')
    .insert('#username', email)
    .insert('#password', password)
    .click('.btn__primary--large.from__button--floating')
    .wait('.nav-item--mynetwork')
    .wait(3000)
  } catch(e) {
    console.log("An error occured while attempting to login to linkedin.")
    throw(e);
  }
}

function cleanName(name) {
  return name.replace(/[^a-zA-Z0-9àáâãäåæçèéêëìíîïñøòóôõöœùúûüýÿ]/g,' ').trim(); //.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function getHistory(nightmare,name,searchInterval) {
  console.assert(name);
  let nameClean = cleanName(name);

  try {
    let history = await nightmare
    .wait('.nav-item--mynetwork')
    .click('.nav-item--mynetwork a')
    .wait('.mn-community-summary__link')
    .click('.mn-community-summary__link')
    .wait('.mn-connections__search-input')
    .wait(searchInterval)
    .insert('.mn-connections__search-input', nameClean)
    .wait(2000)
    .click('.mn-connection-card__link')
    .wait('ul.pv-top-card--list')
    .scrollTo(1024, 0)
    .wait("section#experience-section")
    .evaluate( ()=> {
      try {
          let result = [];
          let titles = document.querySelectorAll("section#experience-section div.pv-entity__summary-info h3.t-16");
          let companies = document.querySelectorAll("section#experience-section div.pv-entity__summary-info p.pv-entity__secondary-title");
          for( let i=0 ; i<titles.length ; ++i ) {
            result.push({
              title: titles[i].innerText,
              company: companies[i].innerText
            });
          }
          return result;

//        return $('h3').innerText.trim();
        //return document.querySelector('h3').innerText.trim();
      } catch(e) {
        console.log("ERROR CL1: ",JSON.stringify(e));
        return "FAIL "+e.message;
      }
    });
    return history;
  }
  catch(e) {
    console.log("ERROR CL2: ",JSON.stringify(e), e.message);
    if( e.message.startsWith( '.wait() for section#experience-section' ) ) {
      return "No Experience Listed";
    }
    if( e.message.startsWith( '.wait()' ) ) {
      e.restart = true;
      throw e;
    }
    return "EXCEPTION "+e.message;
  }
}

// Actual email extraction procedure
// Crawler looks for seach input box, writes connection name, clicks on first result, and copies connection's email
async function getEmail(nightmare,name,searchInterval) {
  console.assert(name);
  let nameClean = cleanName(name);

  try {
    let email = await nightmare
    .wait('.nav-item--mynetwork')
    .click('.nav-item--mynetwork a')
    .wait('.mn-community-summary__link')
    .click('.mn-community-summary__link')
    .wait('.mn-connections__search-input')
    .wait(searchInterval)
    .insert('.mn-connections__search-input', nameClean)
    .wait(2000)
    .click('.mn-connection-card__link')
    .wait('[data-control-name=contact_see_more]')
    .click('[data-control-name=contact_see_more]')
    .wait('.pv-contact-info')
    .wait(200)
    .evaluate( ()=> {
      try {
        return document.querySelector('.ci-email div a.pv-contact-info__contact-link').href.replace('mailto:', '').trim();
      } catch(e) {
        console.log("ERROR1: ",JSON.stringify(e));
        if( e.message.startsWith("Cannot read property 'href'") ) {
          return "NONE";
        }
        return "FAIL "+e.message;
      }
    });
    return email;
  }
  catch(e) {
    console.log("ERROR2: ",JSON.stringify(e));
    if( e.message.startsWith( '.wait()' ) ) {
      e.restart = true;
      throw e;
    }
    return "EXCEPTION "+e.message;
  }
}

async function main() {
  let emails = await loadEmails();
  writeEmails(emails);

  let params = await readParams(emails);
  params.nightmare = { show: params.showNightmare, waitTimeout: 20000 };

  let nightmare;

  let modeList = {
    email: {
      find: (emails) => findFirstBlank(emails,'email'),
      fetch: (nightmare,name,searchInterval) => getEmail(nightmare,name,searchInterval),
      assign: (emails,person,result) => emails[person.name].email = result
    },
    history: {
      find: (emails) => findFirstBlank(emails,'history'),
      fetch: (nightmare,name,searchInterval) => getHistory(nightmare,name,searchInterval),
      assign: (emails,person,result) => { emails[person.name].history = result }
    },
  }

  let mode = modeList['history'];

  while( mode.find(emails) ) {

    if( !nightmare ) {
      nightmare = Nightmare(params.nightmare);
      await login( nightmare, params.email, params.password );
      await nightmare.inject('js', 'jquery.min.js').wait();
    }

    let person = mode.find(emails);
    if( !person ) break;
    console.log(person.name);
    let result = await mode.fetch(nightmare,person.name,params.searchInterval)
    .catch( e=> {
      if( e.restart ) {
        nightmare._shutdown = true;
      }
      else {
        throw e;
      }
    });
    if( nightmare._shutdown ) {
      await nightmare.end();
      nightmare = null;
      console.log('RESTARTING');
      continue;
    }
    console.log(result);
    mode.assign(emails,person,result);
    writeEmails(emails);
  }

  console.log('Ending...');

  if( nightmare ) {
    await nightmare.end();
  }
}

main();
