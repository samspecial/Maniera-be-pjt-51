/* eslint-disable camelcase */
/* eslint-disable no-underscore-dangle */
/* eslint-disable func-names */
/* eslint-disable no-console */
/* eslint-disable consistent-return */
const bcrypt = require("bcryptjs");
const _ = require("lodash");
const jwt = require("jsonwebtoken");
const mailgun = require("mailgun-js");
const { OAuth2Client } = require("google-auth-library");

require("dotenv").config();
const User = require("../models/User");

const { TOKEN_SECRET, TOKEN_EXPIRY, MAILGUN_APIKEY, DOMAIN, GOOGLE_CLIENT_ID, GOOGLE_AUTH_CLIENT_SECRET } = process.env;
const mg = mailgun({ apiKey: MAILGUN_APIKEY, domain: DOMAIN });

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

/**
 * @method POST
 * @desc registers a new user
 */
exports.signupController = async (req, res) => {
  const { email, password, confirmPassword, firstName, lastName } = req.body;
  try {
    // Check if user exists
    const user = await User.findOne({ email });
    if (user) return res.status(400).json({ error: "Email already exists" });
    if (password !== confirmPassword) res.json(400).json({ error: "Password mismatch" });
    // create an instance of the user
    const newUser = new User({
      email,
      password,
      firstName,
      lastName,
    });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newUser.password, salt);

    // assigning hash password to the newUser
    newUser.password = hash;

    await newUser.save();
    return res.status(200).json({ success: "Registeration success. Please signin." });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
};

/**
 * @method POST
 * @desc signs in a user
 */
exports.signinController = async (req, res) => {
  const { email, password } = req.body;

  try {
    // check if user exists
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    // check if the password matches the user's password
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Invalid Credentials" });

    const payload = {
      user: {
        id: user._id,
      },
    };

    // create token
    const refresh_token = jwt.sign(payload, TOKEN_SECRET, { expiresIn: TOKEN_EXPIRY });
    console.log(refresh_token);
    res.cookie("sessionToken", refresh_token, {
      httpOnly: true,
      maxAge: 1 * 60 * 50 * 1000,
      signed: true,
    });

    res.status(200).json({ refresh_token });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.resetPassword = async (req, res) => {
  const { resetLink, newPass } = req.body;
  const obj = {
    password: newPass,
    resetLink: "",
  };

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(obj.password, salt);
  obj.password = hash;
  try {
    if (resetLink) {
      // eslint-disable-next-line func-names
      jwt.verify(resetLink, process.env.RESET_PASSWORD_KEY, function (error, decodedData) {
        if (error) return res.status(401).json({ error: "Incorrect token or it is expired." });
      });
      let user = await User.findOne({ resetLink }, (err) => {
        if (err) return res.status(400).json({ error: "User with this token does not exist." });
      });
      if (!user) return res.status(400).json({ error: "Incorrect token or it is expired." });
      user = _.extend(user, obj);
      // eslint-disable-next-line no-unused-vars
      user.save((err, result) => {
        if (err) {
          return res.status(400).json({ error: "reset password error" });
          // eslint-disable-next-line no-else-return
        } else {
          return res.status(200).json({ message: "Your password has been changed" });
        }
      });
    }
  } catch (error) {
    return res.status(401).json({ error: "Authentication error!!!" });
  }
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    // eslint-disable-next-line consistent-return
    const user = User.findOne({ email }, (err) => {
      if (err || !user) return res.status(400).json({ error: "User with this email does not exist" });

      // eslint-disable-next-line no-underscore-dangle
      const token = jwt.sign({ _id: user._id }, process.env.RESET_PASSWORD_KEY, { expiresIn: "20m" });
      const data = {
        from: "noreply@hello.com",
        to: email,
        subject: "Account Activation Link",
        html: `
            <a><h2>Please click on the given link to reset your password</h2>
            <p>${process.env.CLIENT_URL}/resetpassword/${token}</p></a>
      `,
      };

      // eslint-disable-next-line no-shadow
      return user.updateOne({ resetLink: token }, function (err) {
        if (err) {
          return res.status(400).json({ error: "reset password link error" });
          // eslint-disable-next-line no-else-return
        } else {
          mg.messages().send(data, function (error) {
            console.log(error);
            if (error) {
              return res.json({
                error: err.message,
              });
            }
            return res.json({ message: "Email has been sent, kindly follow the instructions" });
          });
        }
      });
    });
  } catch (error) {
    res.status(500).json({ error: "Unable to change password" });
  }
};

exports.googleSigninController = async (req, res) => {
  try {
    const { token } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email_verified, email, given_name, family_name } = payload;
    const password = email + GOOGLE_AUTH_CLIENT_SECRET;
    const passwordHash = await bcrypt.hash(password, 12);
    if (!email_verified) return res.status(401).json({ error: "Email verification failed" });
    const user = await User.findOne({ email });
    if (user) {
      const payLoad = {
        user: {
          id: user._id,
        },
      };
      // create token
      const refresh_token = jwt.sign(payLoad, TOKEN_SECRET, { expiresIn: TOKEN_EXPIRY });
      res.cookie("sessionToken", refresh_token, {
        httpOnly: true,
        maxAge: 2 * 24 * 60 * 60 * 1000,
      });
      return res.status(200).json({ message: "Login successful" });
    }
    const newUser = new User({
      firstName: given_name,
      lastName: family_name,
      email,
      password: passwordHash,
    });
    await newUser.save();
    const payLoad = {
      user: {
        id: newUser._id,
      },
    };
    // create token
    const refresh_token = jwt.sign(payLoad, TOKEN_SECRET, { expiresIn: TOKEN_EXPIRY });
    res.cookie("sessionToken", refresh_token, {
      httpOnly: true,
      maxAge: 2 * 24 * 60 * 60 * 1000,
    });
    res.status(200).json({ message: "Account creation successful, you have been logged in" });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.auth = async (req, res, next) => {
  const token = req.cookies.auth;
  User.findByToken(token, (err, user) => {
    if (err) throw err;
    if (!user)
      return res.json({
        error: true,
      });

    req.token = token;
    req.user = user;
    next();
  });
};

exports.logout = async (req, res) => {
  try {
    req.user.deleteToken(req.token, (err, user) => {
      if (err) return res.status(400).send(err);
      res.sendStatus(200).json({ message: "Logout successful" });
    });
  } catch (error) {
    res.status(500).json({ error: "Unable to log out" });
  }
};
