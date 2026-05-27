require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const employees = [
  { id: 1,   name: 'MANIMARAN RATHINAM',          alias_name: 'MANIMARAN',         gender: 'MALE'   },
  { id: 2,   name: 'SELVENDRAN RASU',              alias_name: 'SELVENDRAN',         gender: 'MALE'   },
  { id: 4,   name: 'BALAMURUGAN RASU',             alias_name: 'BALAMURUGAN',        gender: 'MALE'   },
  { id: 5,   name: 'ARULMURUGAN SUBRAMANIAN',      alias_name: 'ARULMURUGAN',        gender: 'MALE'   },
  { id: 8,   name: 'SYED ABUTHAHIR SAYUBU',        alias_name: 'SYED ABUTHAHIR',     gender: 'MALE'   },
  { id: 9,   name: 'SUDHARSHINI MOHAN',            alias_name: 'SUDHARSHINI',        gender: 'FEMALE' },
  { id: 11,  name: 'S KOLANCHIAPPAN',              alias_name: 'KOLANCHIAPPAN',      gender: 'MALE'   },
  { id: 13,  name: 'R THAMODARAN',                 alias_name: 'THAMODARAN',         gender: 'MALE'   },
  { id: 15,  name: 'PARIMANAM RAMASAMY',           alias_name: 'PARIMANAM',          gender: 'MALE'   },
  { id: 23,  name: 'VENGADESAN JOTHIMANI',         alias_name: 'VENKATESAN',         gender: 'MALE'   },
  { id: 30,  name: 'S. RAJESWARI',                 alias_name: 'RAJI-1',             gender: 'FEMALE' },
  { id: 31,  name: 'VIJAYALAKSHMI',                alias_name: 'VIJI-1',             gender: 'FEMALE' },
  { id: 33,  name: 'YOGAPRIYA SARAVANAN',          alias_name: 'YOGAPRIYA',          gender: 'FEMALE' },
  { id: 38,  name: 'PANJU',                        alias_name: 'PANJU',              gender: 'FEMALE' },
  { id: 55,  name: 'BHARATHARATHINAM GANESAN',     alias_name: 'BHARATHI',           gender: 'FEMALE' },
  { id: 64,  name: 'RAJESHWARI SEENIVASAN',        alias_name: 'RAJI-2',             gender: 'FEMALE' },
  { id: 74,  name: 'MUTHUKUMAR KRISHNAN',          alias_name: 'MUTHUKUMAR',         gender: 'MALE'   },
  { id: 77,  name: 'P. DHANALAKSHMI',              alias_name: 'DHANALAKSHMI',       gender: 'FEMALE' },
  { id: 80,  name: 'SATHISH ARUMUGAM',             alias_name: 'SATHISH',            gender: 'MALE'   },
  { id: 89,  name: 'TAMILSELVI P',                 alias_name: 'TAMILSELVI',         gender: 'FEMALE' },
  { id: 91,  name: 'BALASUBRAMANIAN LAKSHMANAN',   alias_name: 'BALASUBRAMANIYAN',   gender: 'MALE'   },
  { id: 92,  name: 'RAJKUMAR',                     alias_name: 'RAJKUMAR',           gender: 'MALE'   },
  { id: 93,  name: 'POTHURANI GOPINATH',           alias_name: 'RANI',               gender: 'FEMALE' },
  { id: 96,  name: 'DHARMARAJAN',                  alias_name: 'DHARMARAJAN',        gender: 'MALE'   },
  { id: 97,  name: 'DEEPA M',                      alias_name: 'DEEPA',              gender: 'FEMALE' },
  { id: 100, name: 'M. VISHNUPRIYA',               alias_name: 'VISHNUPRIYA',        gender: 'FEMALE' },
  { id: 109, name: 'VIJAYALAKSHMI ALAGU',          alias_name: 'VIJI-2',             gender: 'FEMALE' },
  { id: 111, name: 'JAYANTHI ALAGURAJA',           alias_name: 'JEYANTHI',           gender: 'FEMALE' },
  { id: 112, name: 'NIVETHA PARAMASIVAM',          alias_name: 'NIVETHA',            gender: 'FEMALE' },
  { id: 115, name: 'SAHANA M',                     alias_name: 'SAHANA',             gender: 'FEMALE' },
  { id: 122, name: 'PANDIKUMAR',                   alias_name: 'PANDIKUMAR',         gender: 'MALE'   },
  { id: 125, name: 'CHINNAMMAL',                   alias_name: 'CHINNAMMAL',         gender: 'FEMALE' },
  { id: 128, name: 'ARIVUNITHI',                   alias_name: 'ARIVUNITHI',         gender: 'MALE'   },
  { id: 129, name: 'YAMUNA',                       alias_name: 'YAMUNA',             gender: 'FEMALE' },
  { id: 131, name: 'SAKTHIVEL',                    alias_name: 'SAKTHIVEL 2',        gender: 'MALE'   },
  { id: 132, name: 'PANDI',                        alias_name: 'PANDI',              gender: 'MALE'   },
  { id: 133, name: 'PRABHAKARAN',                  alias_name: 'PRABHAKARAN',        gender: 'MALE'   },
  { id: 134, name: 'VIDHYA',                       alias_name: 'VIDHYA',             gender: 'FEMALE' },
  { id: 135, name: 'PRIYANKA',                     alias_name: 'PRIYANKA',           gender: 'FEMALE' },
  { id: 136, name: 'KAVYA SRI',                    alias_name: 'KAVYA',              gender: 'FEMALE' },
  { id: 137, name: 'SHANTHI',                      alias_name: 'SHANTHI',            gender: 'FEMALE' },
  { id: 138, name: 'MUTHUPRIYA',                   alias_name: 'MUTHUPRIYA',         gender: 'FEMALE' },
  { id: 139, name: 'SANTHIYA',                     alias_name: 'SANTHIYA',           gender: 'FEMALE' },
  { id: 140, name: 'VARSHINI',                     alias_name: 'VARSHINI',           gender: 'FEMALE' },
];

async function seed() {
  try {
    // Create table with alias_name column
    await db.execute(`
      CREATE TABLE IF NOT EXISTS employees (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        alias_name TEXT,
        gender     TEXT NOT NULL
      )
    `);
    console.log('✅ employees table ready');

    // Add alias_name column if table already existed without it
    try {
      await db.execute(`ALTER TABLE employees ADD COLUMN alias_name TEXT`);
      console.log('✅ alias_name column added');
    } catch (e) {
      // Column already exists — ignore
    }

    // Insert / update all employees
    for (const emp of employees) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO employees (id, name, alias_name, gender) VALUES (?, ?, ?, ?)`,
        args: [emp.id, emp.name, emp.alias_name, emp.gender],
      });
    }

    console.log(`✅ Inserted / updated ${employees.length} employees successfully`);
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    process.exit(0);
  }
}

seed();
