
require('dotenv').config();
const formData = require('form-data');
const Mailgun = require('mailgun.js');

async function SendSimpleMessage(name, email) {
  const mailgun = new Mailgun(formData);
  const mg = mailgun.client({
    username: "api",
    key: process.env.MG_API_KEY,
    // When you have an EU-domain, you must specify the endpoint:
    // url: "https://api.eu.mailgun.net"
  });
  try {
    const data = await mg.messages.create("sandboxb6a6fda3f9614bf49f138c7adfdc400c.mailgun.org", {
      from: "Mailgun Sandbox <postmaster@sandboxb6a6fda3f9614bf49f138c7adfdc400c.mailgun.org>",
      //to: ["Alex Reiner <alexreiner98@gmail.com>"],
      to: [`${name} <${email}>`],
      subject: `Hello ${name}`,
      text: `Congratulations ${name}, you just sent an email with Mailgun! You are truly awesome!`,
    });

    console.log(data); // logs response data
  } catch (error) {
    console.log(error); //logs any error
  }
}

module.exports = {SendSimpleMessage};