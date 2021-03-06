/* eslint-disable func-names */
/* eslint-disable global-require */
import express from 'express';

import helmet from 'helmet';
import webpack from 'webpack';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { renderRoutes } from 'react-router-config';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import cookieParser from 'cookie-parser';
import boom from '@hapi/boom';
import passport from 'passport';
import axios from 'axios';
import path from 'path';
import reducer from '../frontend/reducers';
import Layout from '../frontend/components/Layout';
import serverRoutes from '../frontend/routes/serverRoutes';
import getManifest from './getManifest';
import config from './config'

// move config to external file, to call in any file, with onyl 1 call
const { ENV, PORT } = config;

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());
app.use(passport.session());

// app.use('/assets', express.static(path.join(__dirname, '..', '/public')));
app.use(express.static(path.join(__dirname, 'public')));

require('./utils/auth/strategies/basic');

if (ENV === 'development') {
  const webPackConfig = require('../../webpack.config');
  const webpackDevMiddleware = require('webpack-dev-middleware');
  const webpackHotMiddleware = require('webpack-hot-middleware');
  const compiler = webpack(webPackConfig);
  const serverConfig = { port: PORT, hot: true };
  app.use(webpackDevMiddleware(compiler, serverConfig));
  app.use(webpackHotMiddleware(compiler));
} else {
  app.use((req, res, next) => {
    // req.hashManifest = getManifest();
    if (!req.hashManifest) req.hashManifest = getManifest();
    next();
  });
  app.use(helmet()); // to add security Headers
  app.use(helmet.permittedCrossDomainPolicies());

  // used to disable powered by express, to avoid targeted attacks.
  // app.disable('x-powered-by'); // moved to before res.send()
}

const setResponse = (html, preloadedState, manifest) => {
  const mainStyles = manifest ? manifest['main.css'] : '/assets/app.css';
  const mainBuild = manifest ? manifest['main.js'] : '/assets/app.js';
  const vendorBuild = manifest ? manifest['vendors.js'] : '/assets/vendor.js';

  return (
    `<!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="ie=edge">
        <meta charset="utf-8" />
        <link rel="stylesheet" href="${mainStyles}" type="text/css"/>
        <title>Video</title>
      </head>
      <body>
        <div id="app">${html}</div>
        <script id="preloadedState">
          window.__PRELOADED_STATE__ = ${JSON.stringify(preloadedState).replace(/</g, '\\u003c')}
        </script>
        <script src="${mainBuild}" type="text/javascript"></script>
        <script src="${vendorBuild}" type="text/javascript"></script>
      </body>
    </html>`
  );
};

const renderApp = async (req, res) => {
  let initialState;
  const { token, email, name, id } = req.cookies;

  try {
    let movieList = await axios({
      url: `${process.env.API_URL}/api/movies`,
      headers: { Authorization: `Bearer ${token}` },
      method: 'get',
    });

    movieList = movieList.data.data;
    initialState = {
      user: {
        id, email, name,
      },
      myList: [],
      trends: movieList.filter(movie => movie.contentRating === 'PG' && movie._id),
      originals: movieList.filter(movie => movie.contentRating === 'G' && movie._id)
    };
  } catch (err) {
    initialState = {
      user: {},
      myList: [],
      trends: [],
      originals: []
    }
  }

  const store = createStore(reducer, initialState);
  const preloadedState = store.getState();
  const isLogged = (initialState.user.id);
  const html = renderToString(
    <Provider store={store}>
      <StaticRouter
        location={req.url} // url to render
        context={{
          logged: true, // or any variable to send to front
        }}
      >
        <Layout>
          {renderRoutes(serverRoutes(isLogged))}
        </Layout>
      </StaticRouter>
    </Provider>
  )
  res.removeHeader('x-powered-by');
  res.send(setResponse(html, preloadedState, req.hashManifest));
};

app.post("/auth/sign-in", async function (req, res, next) {
  passport.authenticate("basic", function (error, data) {
    try {
      if (error || !data) {
        next(boom.unauthorized());
      }

      req.login(data, { session: false }, async function (err) {
        if (err) {
          next(err);
        }


        const { token, user } = data;

        res.cookie("token", token, {
          httpOnly: !(ENV === 'development'),
          secure: !(ENV === 'development')
        });

        res.status(200).json({ ...user, token });
      });
    } catch (err) {
      next(err);
    }
  })(req, res, next);
});

app.post("/auth/sign-up", async function (req, res, next) {
  const { body: user } = req;

  try {
    const userData = await axios({
      url: `${process.env.API_URL}/api/auth/sign-up`,
      method: "post",
      data: {
        'email': user.email,
        'name': user.name,
        'password': user.password
      }
    });
    res.status(201).json({
      name: req.body.name,
      email: req.body.email,
      id: userData.data.id
    });
  } catch (error) {
    next(error);
  }
});

app.post('/user-movies', async function (req, res, next) {
  try {
    const { body: userMovie } = req;
    const { token } = req.cookies;

    const { data, status } = await axios({
      url: `${process.env.API_URL}/api/user-movies`,
      headers: { Authorization: `Bearer ${token}` },
      method: 'post',
      data: userMovie,
    });

    const {
      data: { movieExist },
    } = data;

    if (status !== 200 && status !== 201) {
      next(boom.badImplementation());
    }

    const statusCode = movieExist ? 200 : 201;
    res.status(statusCode).json(data);
  } catch (error) {
    next(error);
  }

});

app.get('*', renderApp);

app.listen(PORT, (err) => {
  if (err) console.log(err);
  else console.log(`${ENV} server running on Port ${PORT}`);
});
