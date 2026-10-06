// Seeds demo data on first run (only if the users table is empty).
// Run manually with: npm run seed
const bcrypt = require('bcryptjs');
const { db, transaction } = require('./db');
const { today, addDays, SHELF_LIFE_DAYS } = require('./utils');

function seedIfEmpty() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (c > 0) return false;

  transaction(() => {
    // --- Users ---
    const addUser = db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)');
    addUser.run('admin', bcrypt.hashSync('admin123', 10), 'System Administrator', 'admin');
    addUser.run('staff', bcrypt.hashSync('staff123', 10), 'Lab Technician', 'staff');

    // --- Donors ---
    const donors = [
      ['Arun Kumar', '1990-04-12', 'Male', 'O+', '9841000001', 'arun.k@example.com', 'T. Nagar, Chennai'],
      ['Priya Sharma', '1993-09-21', 'Female', 'A+', '9841000002', 'priya.s@example.com', 'Adyar, Chennai'],
      ['Mohammed Faizal', '1988-01-30', 'Male', 'B+', '9841000003', 'faizal@example.com', 'Anna Nagar, Chennai'],
      ['Lakshmi Narayanan', '1985-07-05', 'Female', 'AB+', '9841000004', null, 'Velachery, Chennai'],
      ['Karthik Raja', '1995-11-18', 'Male', 'O-', '9841000005', 'karthik.r@example.com', 'Tambaram, Chennai'],
      ['Divya Menon', '1991-03-02', 'Female', 'B-', '9841000006', 'divya.m@example.com', 'Porur, Chennai'],
      ['Suresh Babu', '1982-12-09', 'Male', 'A-', '9841000007', null, 'Guindy, Chennai'],
      ['Anitha Joseph', '1997-05-25', 'Female', 'O+', '9841000008', 'anitha.j@example.com', 'Mylapore, Chennai'],
      ['Rahul Verma', '1989-08-14', 'Male', 'AB-', '9841000009', 'rahul.v@example.com', 'Kodambakkam, Chennai'],
      ['Meena Iyer', '1992-02-27', 'Female', 'A+', '9841000010', 'meena.i@example.com', 'Besant Nagar, Chennai'],
      ['Vignesh S', '1999-06-16', 'Male', 'B+', '9841000011', 'vignesh@example.com', 'Perungudi, Chennai'],
      ['Fatima Begum', '1986-10-03', 'Female', 'O+', '9841000012', null, 'Triplicane, Chennai'],
    ];
    const addDonor = db.prepare(
      'INSERT INTO donors (name, dob, gender, blood_group, phone, email, address) VALUES (?,?,?,?,?,?,?)'
    );
    donors.forEach((d) => addDonor.run(...d));

    // --- Donations: [donorId, group, units, hemoglobin, daysAgo] ---
    const donations = [
      [1, 'O+', 2, 14.2, 5],
      [2, 'A+', 1, 13.1, 12],
      [3, 'B+', 2, 14.8, 20],
      [4, 'AB+', 1, 13.5, 8],
      [5, 'O-', 1, 15.0, 3],
      [6, 'B-', 1, 12.9, 30],
      [7, 'A-', 2, 14.0, 38],   // close to expiry
      [8, 'O+', 3, 13.8, 15],
      [9, 'AB-', 1, 13.2, 25],
      [10, 'A+', 2, 13.9, 40],  // expires in ~2 days
      [11, 'B+', 1, 14.4, 10],
      [12, 'O+', 4, 13.6, 2],
      [1, 'O+', 2, 14.0, 150],  // old donation, already expired (shows expired handling)
    ];
    const addDonation = db.prepare(
      `INSERT INTO donations (donor_id, blood_group, units, units_remaining, hemoglobin, donation_date, expiry_date, notes)
       VALUES (?,?,?,?,?,?,?,?)`
    );
    const updDonor = db.prepare(
      'UPDATE donors SET last_donation_date = MAX(COALESCE(last_donation_date, ?), ?) WHERE id = ?'
    );
    donations.forEach(([donorId, group, units, hb, daysAgo]) => {
      const date = addDays(today(), -daysAgo);
      addDonation.run(donorId, group, units, units, hb, date, addDays(date, SHELF_LIFE_DAYS), 'Seed data');
      updDonor.run(date, date, donorId);
    });

    // --- Requests ---
    const addReq = db.prepare(
      `INSERT INTO requests (patient_name, hospital, contact, blood_group, units, urgency, notes)
       VALUES (?,?,?,?,?,?,?)`
    );
    addReq.run('Ramesh Pillai', 'Apollo Hospital', '04428290200', 'O+', 2, 'urgent', 'Post-surgery requirement');
    addReq.run('Sneha Rao', 'MIOT International', '04442002288', 'AB-', 3, 'critical', 'Emergency - road accident');
    addReq.run('Joseph Antony', 'Government General Hospital', '04425305000', 'B+', 1, 'normal', 'Scheduled transfusion');
  });

  console.log('[seed] Demo data created. Login: admin/admin123 or staff/staff123');
  return true;
}

module.exports = { seedIfEmpty };

if (require.main === module) {
  const created = seedIfEmpty();
  if (!created) console.log('[seed] Database already has data; nothing to do.');
}
