# Node HTML to PDF Creator

## Installation

To install the necessary dependencies, run the following command:

```sh
npm install
```

## Build

To build the project, use the following command:

```sh
npm run build
```

## Development

To start the development server, run:

```sh
npm run dev
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