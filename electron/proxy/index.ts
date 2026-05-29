import { ProxyServer } from './server'
import { ProxyConfig } from './types'

function parseArgs(): ProxyConfig {
  const args = process.argv.slice(2)
  let port = 34567
  let configB64 = ''

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--config' && args[i + 1]) {
      configB64 = args[i + 1]
      i++
    }
  }

  if (!configB64) {
    process.stderr.write('Missing --config argument\n')
    process.exit(1)
  }

  const configJson = Buffer.from(configB64, 'base64').toString('utf8')
  const config: ProxyConfig = JSON.parse(configJson)
  config.port = port
  config.host = config.host || '127.0.0.1'

  return config
}

async function main() {
  const config = parseArgs()
  const server = new ProxyServer(config)

  try {
    await server.start()
    process.stdout.write(JSON.stringify({ type: 'ready', port: config.port }) + '\n')
  } catch (err) {
    process.stderr.write(`Failed to start proxy: ${err}\n`)
    process.exit(1)
  }

  process.on('SIGTERM', async () => {
    await server.stop()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    await server.stop()
    process.exit(0)
  })
}

main()
