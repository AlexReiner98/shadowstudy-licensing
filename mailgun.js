
require('dotenv').config();
const formData = require('form-data');
const Mailgun = require('mailgun.js');

async function SendSimpleMessage(name, email, url) {
  const mailgun = new Mailgun(formData);

  const mg = mailgun.client({
    username: "api",
    key: process.env.MG_API_KEY,
  });
  try {
    const data = await mg.messages.create("sandboxb6a6fda3f9614bf49f138c7adfdc400c.mailgun.org", {
      from: "Mailgun Sandbox <postmaster@sandboxb6a6fda3f9614bf49f138c7adfdc400c.mailgun.org>",
      //to: ["Alex Reiner <alexreiner98@gmail.com>"],
      to: [`${name} <${email}>`],
      subject: `Hi ${name}`,
      text: `Hi ${name}, please click the link to verify your shadow study account: ${url}`,
    });

  } catch (error) {
    console.log(error); //logs any error
  }
}

module.exports = {SendSimpleMessage};