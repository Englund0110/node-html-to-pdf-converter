# Node HTML to PDF Creator

## Prerequisites

This project uses [pnpm](https://pnpm.io/) as its package manager. If you don't have it yet, enable it through Corepack (bundled with Node.js):

```sh
corepack enable pnpm
```

Or install it globally:

```sh
npm install -g pnpm
```

## Installation

To install the necessary dependencies, run the following command:

```sh
pnpm install
```

## Build

To build the project, use the following command:

```sh
pnpm build
```

## Development

To start the development server, run:

```sh
pnpm dev
```

## Testing

To run the tests, use:

```sh
pnpm test
```

## Docker

### Building the Docker Image

To build the Docker image, use the following command:

```sh
docker build -t node-html-to-pdf-creator .
```

### Running the Docker Container

To run the Docker container, use the following command:

```sh
docker run -p 3000:3000 node-html-to-pdf-creator
```

#### Explanation of Port Binding

The `-p 3000:3000` option in the `docker run` command is used for port binding. It maps port 3000 of your host machine to port 3000 of the Docker container. This means that any network traffic sent to port 3000 on your host machine will be forwarded to port 3000 in the container. This is useful for accessing services running inside the container from your host machine.
